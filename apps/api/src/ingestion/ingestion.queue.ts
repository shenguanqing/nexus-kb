import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ingestionPayloadSchema } from '@nexus-kb/contracts';
import type { IngestionPayload } from '@nexus-kb/contracts';
import { Queue, Worker } from 'bullmq';

import { AppConfig } from '../config/app-config';
import { IngestionProcessor } from './ingestion.processor';

@Injectable()
export class IngestionQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue<IngestionPayload>;
  private worker?: Worker<IngestionPayload>;

  constructor(
    private readonly config: AppConfig,
    private readonly processor: IngestionProcessor,
  ) {
    this.queue = new Queue<IngestionPayload>('ingestion', {
      connection: { url: config.values.REDIS_URL },
    });
  }

  onModuleInit(): void {
    this.worker = new Worker<IngestionPayload>(
      'ingestion',
      async (job) => this.processor.process(job.data),
      {
        connection: { url: this.config.values.REDIS_URL },
        concurrency: this.config.values.INGESTION_CONCURRENCY,
      },
    );
  }

  async enqueue(payload: IngestionPayload): Promise<void> {
    const validated = ingestionPayloadSchema.parse(payload);
    await this.queue.add('parse', validated, {
      jobId: validated.ingestionJobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}
