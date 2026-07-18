import { Controller, Get, Res } from '@nestjs/common';
import { statfs } from 'node:fs/promises';
import type { FastifyReply } from 'fastify';

import { Public } from '../auth/public.decorator';
import { AppConfig } from '../config/app-config';
import { HealthService } from '../health/health.service';
import { IngestionQueue } from '../ingestion/ingestion.queue';
import { MetricsService } from './metrics.service';

@Public()
@Controller()
export class MetricsController {
  constructor(
    private readonly config: AppConfig,
    private readonly health: HealthService,
    private readonly queue: IngestionQueue,
    private readonly metrics: MetricsService,
  ) {}

  @Get('metrics')
  async getMetrics(@Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    await Promise.all([this.refreshHealth(), this.refreshQueue(), this.refreshDisk()]);
    void reply.type(this.metrics.contentType);
    return this.metrics.render();
  }

  private async refreshHealth(): Promise<void> {
    const result = await this.health.readiness();
    this.metrics.setDependencyHealth(result.checks);
  }

  private async refreshQueue(): Promise<void> {
    try {
      const snapshot = await this.queue.metricsSnapshot();
      this.metrics.setQueueSnapshot(snapshot.counts, snapshot.oldestWaitSeconds);
      this.metrics.setDependencyHealth({ redisQueue: { status: 'up' } });
    } catch {
      this.metrics.setDependencyHealth({ redisQueue: { status: 'down' } });
    }
  }

  private async refreshDisk(): Promise<void> {
    try {
      const stats = await statfs(this.config.values.RAW_DOCS_PATH);
      const blocks = Number(stats.blocks);
      const available = Number(stats.bavail);
      this.metrics.setDiskUsage(blocks > 0 ? 1 - available / blocks : 0);
      this.metrics.setDependencyHealth({ rawDocsDisk: { status: 'up' } });
    } catch {
      this.metrics.setDependencyHealth({ rawDocsDisk: { status: 'down' } });
    }
  }
}
