import { describe, expect, it, vi } from 'vitest';

import { UserDirectoryService } from '../src/access/user-directory.service';
import { AclPolicy } from '../src/auth/acl-policy';
import type { Identity } from '../src/auth/identity';
import type { PrismaService } from '../src/database/prisma.service';

const adminIdentity: Identity = {
  tenantId: 'tenant-a',
  userId: 'admin-a',
  department: 'platform',
  roles: ['admin'],
  allowedSensitivities: ['public', 'internal', 'confidential'],
  capabilities: ['access:read'],
  defaultSensitivity: 'internal',
};

function fixture() {
  const upsert = vi.fn().mockResolvedValue({});
  const findMany = vi.fn().mockResolvedValue([
    {
      tenantId: 'tenant-a',
      userId: 'user-a',
      department: 'finance',
      roles: ['document_admin'],
      lastAuthenticatedAt: new Date('2026-07-18T08:00:00.000Z'),
    },
  ]);
  const count = vi.fn().mockResolvedValue(1);
  const prisma = { userDirectoryEntry: { upsert, findMany, count } } as unknown as PrismaService;
  return { service: new UserDirectoryService(prisma, new AclPolicy()), upsert, findMany, count };
}

describe('UserDirectoryService', () => {
  it('observes only verified identity fields with normalized roles', async () => {
    const deps = fixture();
    await deps.service.observe({ ...adminIdentity, roles: ['admin', 'admin'] });

    const [upsertInput] = deps.upsert.mock.calls[0] as [
      {
        where: { tenantId_userId: { tenantId: string; userId: string } };
        create: { tenantId: string; userId: string; department: string; roles: string[] };
      },
    ];
    expect(upsertInput).toMatchObject({
      where: { tenantId_userId: { tenantId: 'tenant-a', userId: 'admin-a' } },
      create: {
        tenantId: 'tenant-a',
        userId: 'admin-a',
        department: 'platform',
        roles: ['admin'],
      },
    });
    expect(JSON.stringify(deps.upsert.mock.calls)).not.toContain('capabilities');
  });

  it('returns a tenant-scoped paginated directory for administrators', async () => {
    const deps = fixture();
    const result = await deps.service.query(
      { query: 'user', department: 'finance', offset: 25, limit: 25 },
      adminIdentity,
    );

    expect(deps.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        department: 'finance',
        userId: { contains: 'user', mode: 'insensitive' },
      },
      orderBy: [{ lastAuthenticatedAt: 'desc' }, { userId: 'asc' }],
      skip: 25,
      take: 25,
    });
    expect(result).toEqual({
      users: [
        {
          userId: 'user-a',
          department: 'finance',
          roles: ['user'],
          roleSource: 'identity',
          status: 'observed',
          lastAuthenticatedAt: '2026-07-18T08:00:00.000Z',
        },
      ],
      total: 1,
      offset: 25,
      limit: 25,
      scope: 'tenant',
    });
  });

  it('forces non-platform readers to their verified department', async () => {
    const deps = fixture();
    const identity = {
      ...adminIdentity,
      department: 'finance',
      roles: ['user'],
    };
    const result = await deps.service.query({ offset: 0, limit: 25 }, identity);

    expect(deps.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-a', department: 'finance' } }),
    );
    expect(result.scope).toBe('department');
  });

  it('rejects cross-department filters before database access', async () => {
    const deps = fixture();
    await expect(
      deps.service.query(
        { department: 'legal', offset: 0, limit: 25 },
        { ...adminIdentity, department: 'finance', roles: ['user'] },
      ),
    ).rejects.toMatchObject({ code: 'ACCESS_SCOPE_FORBIDDEN' });
    expect(deps.findMany).not.toHaveBeenCalled();
  });

  it('rejects missing capability before database access', async () => {
    const deps = fixture();
    await expect(
      deps.service.query(
        { offset: 0, limit: 25 },
        { ...adminIdentity, capabilities: ['documents:read'] },
      ),
    ).rejects.toMatchObject({ code: 'CAPABILITY_REQUIRED' });
    expect(deps.findMany).not.toHaveBeenCalled();
  });

  it('protects the final effective administrator, including legacy data', async () => {
    const entries = [
      {
        tenantId: 'tenant-a',
        userId: 'admin-a',
        department: 'platform',
        roles: ['platform_admin'],
        managedRoles: null,
        lastAuthenticatedAt: new Date('2026-07-18T08:00:00.000Z'),
      },
      {
        tenantId: 'tenant-a',
        userId: 'user-a',
        department: 'finance',
        roles: ['editor'],
        managedRoles: null,
        lastAuthenticatedAt: new Date('2026-07-18T08:00:00.000Z'),
      },
    ];
    const update = vi.fn();
    const create = vi.fn();
    const transaction = {
      userDirectoryEntry: {
        findMany: vi.fn().mockResolvedValue(entries),
        update,
      },
      accessAudit: { create },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
        Promise.resolve(callback(transaction)),
      ),
    } as unknown as PrismaService;
    const service = new UserDirectoryService(prisma, new AclPolicy());

    await expect(
      service.updateRoles(
        'admin-a',
        { roles: ['user'] },
        { ...adminIdentity, capabilities: ['access:read', 'access:write'] },
        'trace-role-update',
      ),
    ).rejects.toMatchObject({ code: 'LAST_ADMIN_REQUIRED' });
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
