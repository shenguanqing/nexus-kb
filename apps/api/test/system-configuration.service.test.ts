import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AclPolicy } from '../src/auth/acl-policy';
import type { Identity } from '../src/auth/identity';
import type { OperationalLogger } from '../src/common/operational-logger';
import { parseEnvironment } from '../src/config/app-config';
import type { PrismaService } from '../src/database/prisma.service';
import { SystemConfigurationService } from '../src/system/system-configuration.service';

const identity: Identity = {
  tenantId: 'tenant-a',
  userId: 'admin-a',
  department: 'platform',
  roles: ['admin'],
  allowedSensitivities: ['public', 'internal', 'confidential'],
  capabilities: ['system:read', 'system:configure', 'system:deploy'],
  defaultSensitivity: 'internal',
};

const baseEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://kb:test@postgres:5432/kb',
  REDIS_URL: 'redis://redis:6379',
  PARSER_WORKER_URL: 'http://parser-worker:8000',
  PARSER_INTERNAL_TOKEN: 'internal-test-token-value',
  RAW_DOCS_PATH: '/tmp',
  CHROMA_URL: 'http://chroma:8000',
  SYSTEM_CONFIG_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  DEPLOYMENT_AGENT_URL: 'http://deployment-agent:8200',
  DEPLOYMENT_AGENT_TOKEN: 'deployment-agent-test-token-1234567890',
};

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    tenantId: 'tenant-a',
    version: 1,
    status: 'draft',
    encryptedConfig: 'encrypted-value',
    summary: { values: {}, secretConfigured: {} },
    changedKeys: ['LLM_MODEL'],
    changeReason: '更新模型配置',
    createdBy: 'admin-a',
    createdAt: new Date('2026-08-04T08:00:00.000Z'),
    activatedAt: null,
    ...overrides,
  };
}

function fixture(prisma: PrismaService, enabled = true): SystemConfigurationService {
  const values = parseEnvironment({
    ...baseEnvironment,
    ...(enabled
      ? {}
      : {
          SYSTEM_CONFIG_ENCRYPTION_KEY: '',
          DEPLOYMENT_AGENT_URL: '',
          DEPLOYMENT_AGENT_TOKEN: '',
        }),
  });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as OperationalLogger;
  return new SystemConfigurationService({ values }, prisma, new AclPolicy(), logger);
}

beforeEach(() => {
  Object.assign(process.env, baseEnvironment);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SystemConfigurationService', () => {
  it('requires the administrator role even with deployment capabilities', async () => {
    const service = fixture({} as PrismaService);
    const capabilityOnlyIdentity: Identity = { ...identity, roles: ['user'] };

    await expect(
      service.createVersion(
        { values: { LLM_MODEL: 'model-b' }, secrets: {}, changeReason: '尝试越权修改' },
        capabilityOnlyIdentity,
        '00000000-0000-4000-8000-000000000001',
      ),
    ).rejects.toMatchObject({ code: 'ADMIN_REQUIRED', status: 403 });
  });

  it('fails closed when the dedicated deployment configuration is disabled', async () => {
    const prisma = {} as PrismaService;
    const service = fixture(prisma, false);

    await expect(
      service.createVersion(
        { values: { LLM_MODEL: 'model-b' }, secrets: {}, changeReason: '更新模型' },
        identity,
        '00000000-0000-4000-8000-000000000001',
      ),
    ).rejects.toMatchObject({ code: 'SYSTEM_CONFIG_UNAVAILABLE', status: 503 });
  });

  it('creates an encrypted immutable version and never returns a submitted secret', async () => {
    let createdData: Record<string, unknown> | undefined;
    const created = version();
    const transaction = {
      systemConfigVersion: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          createdData = data;
          return Promise.resolve({ ...created, ...data });
        }),
      },
      accessAudit: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      systemConfigVersion: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((callback: (client: typeof transaction) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
    } as unknown as PrismaService;
    const service = fixture(prisma);

    const response = await service.createVersion(
      {
        values: { LLM_MODEL: 'model-b' },
        secrets: { OPENAI_API_KEY: 'top-secret-provider-key' },
        changeReason: '轮换模型和凭据',
      },
      identity,
      '00000000-0000-4000-8000-000000000001',
    );

    expect(createdData?.encryptedConfig).toEqual(expect.any(String));
    expect(createdData?.encryptedConfig).not.toContain('top-secret-provider-key');
    expect(JSON.stringify(response)).not.toContain('top-secret-provider-key');
    expect(response.secretConfigured.OPENAI_API_KEY).toBe(true);
    expect(transaction.accessAudit.create).toHaveBeenCalledOnce();
  });

  it('accepts an agent result once and records the active version transition', async () => {
    const target = version({ status: 'draft' });
    const deployment = {
      id: '00000000-0000-4000-8000-000000000020',
      tenantId: 'tenant-a',
      configVersionId: target.id,
      previousConfigVersionId: null,
      status: 'running',
      services: ['api'],
      requestedBy: 'admin-a',
      traceId: '00000000-0000-4000-8000-000000000001',
      errorCode: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      configVersion: target,
      previousConfigVersion: null,
    };
    const transaction = {
      systemDeployment: { update: vi.fn().mockResolvedValue({}) },
      systemConfigVersion: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        update: vi
          .fn<
            (input: {
              where: { id: string };
              data: { status: string; activatedAt: Date };
            }) => Promise<object>
          >()
          .mockResolvedValue({}),
      },
      accessAudit: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      systemDeployment: { findFirst: vi.fn().mockResolvedValue(deployment) },
      $transaction: vi.fn((callback: (client: typeof transaction) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
    } as unknown as PrismaService;
    const service = fixture(prisma);

    await expect(
      service.completeFromAgent(deployment.id, { status: 'succeeded', errorCode: null }),
    ).resolves.toEqual({ accepted: true });
    expect(transaction.systemConfigVersion.update).toHaveBeenCalledOnce();
    expect(transaction.systemConfigVersion.update.mock.calls[0]?.[0]).toMatchObject({
      where: { id: target.id },
      data: { status: 'active' },
    });
    expect(transaction.accessAudit.create).toHaveBeenCalledOnce();
  });
});
