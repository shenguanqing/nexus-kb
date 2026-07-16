import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ingestionPayloadSchema } from '@nexus-kb/contracts';
import type { IngestionPayload } from '@nexus-kb/contracts';
import { Queue, UnrecoverableError, Worker } from 'bullmq';

import { OperationalLogger } from '../common/operational-logger';
import { AppConfig } from '../config/app-config';
import { classifyIngestionError } from './ingestion-error';
import { IngestionProcessor } from './ingestion.processor';

@Injectable()
export class IngestionQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue<IngestionPayload>;
  private worker?: Worker<IngestionPayload>;

  constructor(
    private readonly config: AppConfig,
    private readonly processor: IngestionProcessor,
    private readonly logger: OperationalLogger,
  ) {
    this.queue = new Queue<IngestionPayload>('ingestion', {
      connection: { url: config.values.REDIS_URL },
    });
  }

  onModuleInit(): void {
    this.worker = new Worker<IngestionPayload>(
      'ingestion',
      async (job) => {
        try {
          await this.processor.process(job.data);
        } catch (error) {
          const classified = classifyIngestionError(error);
          if (!classified.retryable) {
            throw new UnrecoverableError(classified.code);
          }
          throw error;
        }
      },
      {
        connection: { url: this.config.values.REDIS_URL },
        concurrency: this.config.values.INGESTION_CONCURRENCY,
      },
    );
    this.worker.on('failed', (job, error) => {
      const classified = classifyIngestionError(error);
      this.logger.error('ingestion_queue_failed', {
        jobId: job?.data.ingestionJobId,
        documentId: job?.data.documentId,
        attempts: job?.attemptsMade,
        errorCode: classified.code,
        errorCategory: classified.category,
        status: 'failed',
      });
    });
  }

  async enqueue(payload: IngestionPayload): Promise<void> {
    const validated = ingestionPayloadSchema.parse(payload);
    await this.queue.add('parse', validated, {
      jobId: validated.ingestionJobId,
      attempts: this.config.values.INGESTION_MAX_ATTEMPTS,
      backoff: {
        type: 'exponential',
        delay: this.config.values.INGESTION_RETRY_BASE_DELAY_MS,
      },
      removeOnComplete: 1000,
      removeOnFail: false,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}
