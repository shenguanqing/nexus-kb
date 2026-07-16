import { describe, expect, it } from 'vitest';

import { AclPolicy } from '../src/auth/acl-policy';
import type { Identity } from '../src/auth/identity';

const user: Identity = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  department: 'finance',
  roles: [],
  allowedSensitivities: ['public', 'internal'],
  capabilities: ['documents:read'],
  defaultSensitivity: 'internal',
};

describe('AclPolicy', () => {
  const policy = new AclPolicy();

  it('builds tenant-first document criteria for ordinary users', () => {
    expect(policy.documentWhere(user)).toEqual({
      tenantId: 'tenant-a',
      sensitivity: { in: ['public', 'internal'] },
      OR: [{ sensitivity: 'public' }, { department: 'finance' }, { ownerId: 'user-a' }],
    });
  });

  it('allows tenant administrators across departments without crossing tenants or sensitivities', () => {
    const admin = { ...user, roles: ['platform_admin'] };
    expect(policy.documentWhere(admin)).toEqual({
      tenantId: 'tenant-a',
      sensitivity: { in: ['public', 'internal'] },
    });
    expect(policy.vectorFilter(admin)).toMatchObject({
      tenantId: 'tenant-a',
      tenantWideAccess: true,
    });
    expect(
      policy.canAccessChunk(admin, {
        tenantId: 'tenant-b',
        department: 'finance',
        sensitivity: 'internal',
        ownerId: 'user-a',
      }),
    ).toBe(false);
    expect(
      policy.canAccessChunk(admin, {
        tenantId: 'tenant-a',
        department: 'legal',
        sensitivity: 'confidential',
        ownerId: 'user-b',
      }),
    ).toBe(false);
  });

  it('enforces department, owner and allowed sensitivity for ordinary users', () => {
    expect(
      policy.canAccessChunk(user, {
        tenantId: 'tenant-a',
        department: 'finance',
        sensitivity: 'internal',
        ownerId: 'user-b',
      }),
    ).toBe(true);
    expect(
      policy.canAccessChunk(user, {
        tenantId: 'tenant-a',
        department: 'legal',
        sensitivity: 'internal',
        ownerId: 'user-a',
      }),
    ).toBe(true);
    expect(
      policy.canAccessChunk(user, {
        tenantId: 'tenant-a',
        department: 'legal',
        sensitivity: 'internal',
        ownerId: 'user-b',
      }),
    ).toBe(false);
  });
});
