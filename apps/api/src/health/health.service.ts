import { Injectable } from '@nestjs/common';
import { access, constants } from 'node:fs/promises';
import { connect } from 'node:net';

import { AppConfig } from '../config/app-config';
import { ChromaVectorStore } from '../vector-store/chroma-vector-store';
import { VectorStoreError } from '../vector-store/vector-store-error';

type CheckResult = { status: 'up' | 'down'; reason?: string };

@Injectable()
export class HealthService {
  constructor(
    private readonly config: AppConfig,
    private readonly vectorStore: ChromaVectorStore,
  ) {}

  async readiness(): Promise<{
    status: 'ready' | 'not_ready';
    checks: Record<string, CheckResult>;
  }> {
    const entries = await Promise.all([
      this.checkTcp('postgres', this.config.values.DATABASE_URL),
      this.checkTcp('redis', this.config.values.REDIS_URL),
      this.checkVectorStore(),
      this.checkHttp(
        'parserWorker',
        new URL('/health/ready', this.config.values.PARSER_WORKER_URL).toString(),
      ),
      this.checkDirectory('rawDocs', this.config.values.RAW_DOCS_PATH),
    ]);
    const checks = Object.fromEntries(entries);
    return {
      status: entries.every(([, value]) => value.status === 'up') ? 'ready' : 'not_ready',
      checks,
    };
  }

  private async checkVectorStore(): Promise<[string, CheckResult]> {
    try {
      await this.vectorStore.healthCheck();
      return ['chroma', { status: 'up' }];
    } catch (error) {
      return [
        'chroma',
        {
          status: 'down',
          reason:
            error instanceof VectorStoreError && error.kind === 'configuration_mismatch'
              ? 'configuration_mismatch'
              : 'unavailable',
        },
      ];
    }
  }

  private async checkDirectory(name: string, path: string): Promise<[string, CheckResult]> {
    try {
      await access(path, constants.R_OK | constants.W_OK);
      return [name, { status: 'up' }];
    } catch {
      return [name, { status: 'down', reason: 'unavailable' }];
    }
  }

  private async checkHttp(name: string, url: string): Promise<[string, CheckResult]> {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      return [name, response.ok ? { status: 'up' } : { status: 'down', reason: 'unhealthy' }];
    } catch {
      return [name, { status: 'down', reason: 'unavailable' }];
    }
  }

  private async checkTcp(name: string, url: string): Promise<[string, CheckResult]> {
    const target = new URL(url);
    const port = Number(target.port || (target.protocol === 'postgresql:' ? 5432 : 6379));
    const isUp = await new Promise<boolean>((resolve) => {
      const socket = connect({ host: target.hostname, port });
      const finish = (value: boolean): void => {
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(2_000);
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.once('timeout', () => finish(false));
    });
    return [name, isUp ? { status: 'up' } : { status: 'down', reason: 'unavailable' }];
  }
}
