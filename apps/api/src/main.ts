import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import 'reflect-metadata';

import { AppModule } from './app.module';
import { ApiErrorFilter } from './common/api-error.filter';
import { AppConfig, safeConfigurationSummary } from './config/app-config';
import { MetricsService } from './observability/metrics.service';

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({
    genReqId: (request: IncomingMessage) => {
      const supplied = request.headers['x-trace-id'];
      return typeof supplied === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(supplied)
        ? supplied
        : randomUUID();
    },
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.x-internal-token'],
    },
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });
  const config = app.get(AppConfig);
  const metrics = app.get(MetricsService);
  await app.register(multipart, {
    preservePath: true,
    limits: { fileSize: config.values.MAX_UPLOAD_BYTES, files: 1, fields: 10, parts: 11 },
  });
  app.useGlobalFilters(new ApiErrorFilter());
  const fastify: FastifyInstance = app.getHttpAdapter().getInstance();
  fastify.log.info(
    { configuration: safeConfigurationSummary(config.values) },
    'application configuration loaded',
  );
  fastify.addHook('onRequest', (request, reply, done) => {
    void reply.header('x-trace-id', request.id);
    done();
  });
  fastify.addHook('onResponse', (request, reply, done) => {
    metrics.observeHttp(
      request.method,
      request.routeOptions.url || 'unmatched',
      reply.statusCode,
      reply.elapsedTime,
    );
    done();
  });
  app.enableShutdownHooks();
  await app.listen(config.values.API_PORT, config.values.API_HOST);
}

void bootstrap();
