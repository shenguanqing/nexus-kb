import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ingestionPayloadSchema } from '@nexus-kb/contracts';
import type { IngestionPayload } from '@nexus-kb/contracts';
import { Queue, UnrecoverableError, Worker } from 'bullmq';

import { OperationalLogger } from '../common/operational-logger';
import { AppConfig } from '../config/app-config';
import { MetricsService } from '../observability/metrics.service';
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
    private readonly metrics: MetricsService,
  ) {
    this.queue = new Queue<IngestionPayload>('ingestion', {
      connection: { url: config.values.REDIS_URL },
    });
  }

  onModuleInit(): void {
    if (this.config.values.INDEX_MIGRATION_ACTION !== 'none') return;
    this.worker = new Worker<IngestionPayload>(
      'ingestion',
      async (job) => {
        const startedAt = Date.now();
        try {
          await this.processor.process(job.data);
          this.metrics.observeIngestion('completed', Date.now() - startedAt);
        } catch (error) {
          this.metrics.observeIngestion('failed', Date.now() - startedAt);
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

  async retry(jobId: string, payload?: IngestionPayload): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      if (!payload) throw new Error('Ingestion queue job is missing');
      await this.enqueue(payload);
      return;
    }
    await job.retry('failed');
  }

  async metricsSnapshot(): Promise<{
    counts: Record<string, number>;
    oldestWaitSeconds: number;
  }> {
    const counts = await this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
    const oldestJobs = await this.queue.getJobs(['waiting', 'delayed'], 0, 0, true);
    const oldestTimestamp = oldestJobs[0]?.timestamp;
    return {
      counts,
      oldestWaitSeconds:
        oldestTimestamp === undefined ? 0 : Math.max(0, (Date.now() - oldestTimestamp) / 1000),
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}
