import { createHash } from 'node:crypto';
import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import Redis from 'ioredis';

import type { Identity } from '../auth/identity';
import { ApiException } from '../common/api-exception';
import { AppConfig } from '../config/app-config';
import { MetricsService } from '../observability/metrics.service';

export const QUERY_REDIS_CLIENT = Symbol('QUERY_REDIS_CLIENT');

const RATE_LIMIT_SCRIPT = `
local userCount = redis.call('INCR', KEYS[1])
if userCount == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
local tenantCount = redis.call('INCR', KEYS[2])
if tenantCount == 1 then redis.call('PEXPIRE', KEYS[2], ARGV[3]) end
local allowed = userCount <= tonumber(ARGV[1]) and tenantCount <= tonumber(ARGV[2])
local retryAfter = math.max(redis.call('PTTL', KEYS[1]), redis.call('PTTL', KEYS[2]))
return {allowed and 1 or 0, retryAfter}
`;

type RedisPort = Pick<Redis, 'disconnect' | 'eval'>;

@Injectable()
export class QueryRateLimiter implements OnModuleDestroy {
  private readonly client: RedisPort;
  private readonly ownsClient: boolean;

  constructor(
    private readonly config: AppConfig,
    @Optional() @Inject(QUERY_REDIS_CLIENT) client?: RedisPort,
    @Optional() private readonly metrics?: MetricsService,
  ) {
    this.client =
      client ??
      new Redis(config.values.REDIS_URL, {
        connectTimeout: 5000,
        maxRetriesPerRequest: 1,
      });
    this.ownsClient = !client;
  }

  async assertAllowed(identity: Identity): Promise<void> {
    const windowMilliseconds = 60_000;
    const window = Math.floor(Date.now() / windowMilliseconds);
    const userKey = this.key('user', `${identity.tenantId}:${identity.userId}`, window);
    const tenantKey = this.key('tenant', identity.tenantId, window);
    try {
      const result = await this.client.eval(
        RATE_LIMIT_SCRIPT,
        2,
        userKey,
        tenantKey,
        this.config.values.QUERY_USER_RATE_LIMIT_PER_MINUTE,
        this.config.values.QUERY_TENANT_RATE_LIMIT_PER_MINUTE,
        windowMilliseconds,
      );
      if (!Array.isArray(result) || result.length !== 2) throw new Error('invalid rate result');
      if (Number(result[0]) !== 1) {
        this.metrics?.observeRateLimit('user_or_tenant');
        throw new ApiException('QUERY_RATE_LIMITED', '查询过于频繁，请稍后重试', 429);
      }
    } catch (error) {
      if (error instanceof ApiException) throw error;
      throw new ApiException('QUERY_RATE_LIMITER_UNAVAILABLE', '查询服务暂时不可用', 503);
    }
  }

  onModuleDestroy(): void {
    if (this.ownsClient) this.client.disconnect();
  }

  private key(scope: string, subject: string, window: number): string {
    const digest = createHash('sha256').update(subject).digest('hex');
    return `nexuskb:query-rate:v1:${scope}:${digest}:${window}`;
  }
}
