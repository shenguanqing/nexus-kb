import { createCipheriv, randomBytes } from 'node:crypto';
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

function encryptLegacyConfiguration(configuration: Record<string, string>): string {
  const key = Buffer.from(baseEnvironment.SYSTEM_CONFIG_ENCRYPTION_KEY, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(configuration), 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted].map((value) => value.toString('base64')).join('.');
}

beforeEach(() => {
  Object.assign(process.env, baseEnvironment);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SystemConfigurationService', () => {
  it('recovers one active runtime configuration without exposing secret values in metadata', async () => {
    const active = version({
      status: 'active',
      encryptedConfig: encryptLegacyConfiguration({
        LLM_PROVIDER: 'openai',
        LLM_MODEL: 'model-a',
        OPENAI_API_KEY: 'recovered-secret-key',
      }),
      activatedAt: new Date('2026-08-04T08:05:00.000Z'),
    });
    const prisma = {
      systemConfigVersion: { findMany: vi.fn().mockResolvedValue([active]) },
    } as unknown as PrismaService;
    const recovered = await fixture(prisma).recoveryRuntimeConfiguration();

    expect(recovered.environment).toMatchObject({
      LLM_PROVIDER: 'openai',
      LLM_MODEL: 'model-a',
      OPENAI_API_KEY: 'recovered-secret-key',
    });
    expect(recovered.metadata).toMatchObject({
      active: true,
      tenantId: 'tenant-a',
      configVersionId: active.id,
      version: 1,
      secretConfigured: { OPENAI_API_KEY: true },
    });
    expect(recovered.metadata.runtimeEnvSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(recovered.metadata.valuesSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(recovered.metadata.valueKeys).toContain('LLM_PROVIDER');
    expect(recovered.metadata.valueKeys).toContain('LLM_MODEL');
    expect(JSON.stringify(recovered.metadata)).not.toContain('recovered-secret-key');
  });

  it('fails closed when multiple tenants have active global runtime configurations', async () => {
    const prisma = {
      systemConfigVersion: {
        findMany: vi.fn().mockResolvedValue([
          version({ status: 'active' }),
          version({
            id: '00000000-0000-4000-8000-000000000011',
            tenantId: 'tenant-b',
            status: 'active',
          }),
        ]),
      },
    } as unknown as PrismaService;

    await expect(fixture(prisma).recoveryRuntimeConfiguration()).rejects.toMatchObject({
      code: 'SYSTEM_CONFIG_RECOVERY_AMBIGUOUS',
      status: 409,
    });
  });

  it('hydrates newly managed fields in legacy active configuration responses', async () => {
    const active = version({
      status: 'active',
      encryptedConfig: encryptLegacyConfiguration({
        LLM_PROVIDER: 'none',
        LLM_MODEL: '',
      }),
      summary: {
        values: { LLM_PROVIDER: 'none', LLM_MODEL: '' },
        secretConfigured: {},
      },
      activatedAt: new Date('2026-08-04T08:05:00.000Z'),
    });
    const prisma = {
      systemConfigVersion: { findMany: vi.fn().mockResolvedValue([active]) },
    } as unknown as PrismaService;
    const service = fixture(prisma);

    const response = await service.configuration(identity);

    expect(response.effectiveValues).toMatchObject({
      MAX_PDF_PAGES: '500',
      MAX_IMAGE_PIXELS: '40000000',
      OCR_LANGUAGES: 'ch_sim,en',
      OCR_CONFIDENCE_WARNING_THRESHOLD: '0.5',
      QUERY_MAX_LLM_CONTEXT_CHARS: '32000',
    });
    expect(response.current?.values).toMatchObject({
      MAX_PDF_PAGES: '500',
      OCR_LANGUAGES: 'ch_sim,en',
    });
    expect(response.current?.secretConfigured).toHaveProperty('OPENAI_API_KEY', false);
  });

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

  it('recreates both Parser Workers for CAD, Tika and parser resource changes', () => {
    const service = fixture({} as PrismaService);
    const affectedServices = (
      service as unknown as { affectedServices(changedKeys: string[]): string[] }
    ).affectedServices([
      'DWG_OUTPUT_VERSION',
      'TIKA_ENABLED',
      'MAX_ARCHIVE_ENTRIES',
      'CAD_PREVIEW_TILE_CACHE_BYTES',
    ]);

    expect(affectedServices).toEqual(['api', 'parser-worker', 'parser-worker-dwg']);
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
    ).rejects.toMatchObject({
      code: 'SYSTEM_CONFIG_UNAVAILABLE',
      status: 503,
    });
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
    ).resolves.toEqual({
      accepted: true,
    });
    expect(transaction.systemConfigVersion.update).toHaveBeenCalledOnce();
    expect(transaction.systemConfigVersion.update.mock.calls[0]?.[0]).toMatchObject({
      where: { id: target.id },
      data: { status: 'active' },
    });
    expect(transaction.accessAudit.create).toHaveBeenCalledOnce();
  });
});
