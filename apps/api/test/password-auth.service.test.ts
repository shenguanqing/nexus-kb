import { describe, expect, it, vi } from 'vitest';

import { PasswordAuthService } from '../src/auth/password-auth.service';
import type { AppConfig } from '../src/config/app-config';
import type { PrismaService } from '../src/database/prisma.service';

const account = {
  username: 'platform-admin',
  password: 'password-for-test',
  tenantId: 'tenant-a',
  userId: 'admin-a',
  department: 'platform',
  roles: ['admin'],
  allowedSensitivities: ['public', 'internal', 'confidential'],
  capabilities: ['documents:read', 'access:read', 'access:write'],
  defaultSensitivity: 'internal',
};

function fixture() {
  const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
  const create = vi.fn().mockResolvedValue({});
  const findUnique = vi.fn();
  const remove = vi.fn().mockResolvedValue({});
  const accounts = new Map<string, Record<string, unknown>>();
  const bootstrap = {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
  };
  const userDirectoryEntry = {
    findUnique: vi.fn(({ where }: { where: Record<string, unknown> }) => {
      if ('username' in where) return accounts.get(String(where.username)) ?? null;
      const compound = where.tenantId_userId as { tenantId: string; userId: string };
      return (
        [...accounts.values()].find(
          (entry) => entry.tenantId === compound.tenantId && entry.userId === compound.userId,
        ) ?? null
      );
    }),
    create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
      accounts.set(String(data.username), data);
      return data;
    }),
  };
  const prisma = {
    passwordAuthSession: { deleteMany, create, findUnique, delete: remove },
    passwordAuthBootstrap: bootstrap,
    userDirectoryEntry,
  } as unknown as PrismaService;
  const config = {
    values: {
      NODE_ENV: 'test',
      PASSWORD_AUTH_ENABLED: true,
      PASSWORD_AUTH_SESSION_TTL_SECONDS: 3600,
      PASSWORD_AUTH_MAX_ATTEMPTS: 2,
      PASSWORD_AUTH_WINDOW_SECONDS: 900,
      PASSWORD_AUTH_USERS_JSON: [account],
    },
  } as unknown as AppConfig;
  return {
    service: new PasswordAuthService(config, prisma),
    create,
    deleteMany,
    findUnique,
    remove,
  };
}

describe('PasswordAuthService', () => {
  it('creates an opaque HttpOnly session only for valid credentials', async () => {
    const deps = fixture();
    await deps.service.onModuleInit();
    await expect(
      deps.service.login(account.username, 'wrong-password', '127.0.0.1'),
    ).rejects.toMatchObject({
      code: 'LOGIN_FAILED',
      status: 401,
    });
    expect(deps.create).not.toHaveBeenCalled();

    const result = await deps.service.login(account.username, account.password, '127.0.0.1');
    expect(result.identity).toMatchObject({ tenantId: 'tenant-a', userId: 'admin-a' });
    expect(result.token).toHaveLength(43);
    expect(JSON.stringify(deps.create.mock.calls)).not.toContain(result.token);
    expect(deps.service.sessionCookie(result.token)).toContain('HttpOnly');
    expect(deps.service.sessionCookie(result.token)).toContain('SameSite=Strict');
  });

  it('resolves a non-expired session to configured identity only', async () => {
    const deps = fixture();
    await deps.service.onModuleInit();
    const result = await deps.service.login(account.username, account.password, '127.0.0.1');
    deps.findUnique.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: account.tenantId,
      userId: account.userId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      deps.service.identityFromCookie(`nexuskb_session=${result.token}; other=value`),
    ).resolves.toMatchObject({ userId: 'admin-a', roles: ['admin'] });
  });

  it('rate limits repeated failed passwords without exposing account existence', async () => {
    const deps = fixture();
    await deps.service.onModuleInit();
    await deps.service.login('unknown-user', 'wrong-password', '127.0.0.1').catch(() => undefined);
    await deps.service.login('unknown-user', 'wrong-password', '127.0.0.1').catch(() => undefined);
    await expect(
      deps.service.login('unknown-user', 'wrong-password', '127.0.0.1'),
    ).rejects.toMatchObject({ code: 'LOGIN_RATE_LIMITED', status: 429 });
  });
});
