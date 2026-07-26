import { describe, expect, it } from 'vitest';

import { accessRoleLabel, accessRoleSummary, accessScopeLabel } from './access-presentation';

describe('access presentation', () => {
  it('uses business labels while preserving unknown signed roles', () => {
    expect(accessRoleSummary(['admin'])).toEqual(['管理员']);
    expect(accessRoleLabel('user')).toBe('普通用户');
  });

  it('labels empty roles and server-enforced scopes', () => {
    expect(accessRoleSummary([])).toEqual(['普通用户']);
    expect(accessScopeLabel('tenant', 'finance')).toBe('当前租户');
    expect(accessScopeLabel('department', 'finance')).toBe('finance部门');
  });
});
