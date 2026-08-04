import type { AppRole } from '@nexus-kb/contracts';

export const ADMIN_CAPABILITIES = [
  'documents:read',
  'documents:write',
  'documents:delete',
  'audit:read',
  'system:read',
  'system:configure',
  'system:deploy',
  'access:read',
  'access:write',
] as const;

export const IDENTITY_ROLE_INPUTS = [
  'user',
  'admin',
  'platform_admin',
  'department_admin',
  'document_admin',
  'auditor',
] as const;

const LEGACY_ADMIN_ROLE = 'platform_admin';

export function normalizeAppRoles(roles: readonly string[]): [AppRole] {
  // Only the former platform administrator maps to the new tenant-wide administrator.
  // Other legacy roles are reduced to ordinary users to avoid expanding access during migration.
  return [roles.includes('admin') || roles.includes(LEGACY_ADMIN_ROLE) ? 'admin' : 'user'];
}

export function isAdmin(roles: readonly AppRole[]): boolean {
  return roles.includes('admin');
}
