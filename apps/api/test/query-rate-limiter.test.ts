import { describe, expect, it, vi } from 'vitest';

import type { Identity } from '../src/auth/identity';
import type { AppConfig } from '../src/config/app-config';
import { QueryRateLimiter } from '../src/knowledge/query-rate-limiter';

const identity: Identity = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  department: 'finance',
  roles: [],
  allowedSensitivities: ['public', 'internal'],
  capabilities: ['documents:read'],
  defaultSensitivity: 'internal',
};

function config(): AppConfig {
  return {
    values: {
      REDIS_URL: 'redis://redis:6379',
      QUERY_USER_RATE_LIMIT_PER_MINUTE: 20,
      QUERY_TENANT_RATE_LIMIT_PER_MINUTE: 200,
    },
  } as AppConfig;
}

describe('QueryRateLimiter', () => {
  it('uses opaque user and tenant keys and accepts an allowed result', async () => {
    const evalCommand = vi.fn().mockResolvedValue([1, 59_000]);
    const limiter = new QueryRateLimiter(config(), {
      eval: evalCommand,
      disconnect: vi.fn(),
    });

    await expect(limiter.assertAllowed(identity)).resolves.toBeUndefined();
    const serializedCall = JSON.stringify(evalCommand.mock.calls[0]);
    expect(serializedCall).not.toContain('tenant-a');
    expect(serializedCall).not.toContain('user-a');
  });

  it('fails with a stable 429 when either scope is exhausted', async () => {
    const limiter = new QueryRateLimiter(config(), {
      eval: vi.fn().mockResolvedValue([0, 42_000]),
      disconnect: vi.fn(),
    });

    await expect(limiter.assertAllowed(identity)).rejects.toMatchObject({
      code: 'QUERY_RATE_LIMITED',
      status: 429,
    });
  });

  it('fails closed when Redis is unavailable', async () => {
    const limiter = new QueryRateLimiter(config(), {
      eval: vi.fn().mockRejectedValue(new Error('unavailable')),
      disconnect: vi.fn(),
    });

    await expect(limiter.assertAllowed(identity)).rejects.toMatchObject({
      code: 'QUERY_RATE_LIMITER_UNAVAILABLE',
      status: 503,
    });
  });
});
