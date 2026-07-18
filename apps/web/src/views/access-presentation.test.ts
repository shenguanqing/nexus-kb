import { describe, expect, it } from 'vitest';

import { accessRoleLabel, accessRoleSummary, accessScopeLabel } from './access-presentation';

describe('access presentation', () => {
  it('uses business labels while preserving unknown signed roles', () => {
    expect(accessRoleSummary(['platform_admin', 'custom_reader'])).toEqual([
      '平台管理员',
      'custom_reader',
    ]);
    expect(accessRoleLabel('department_admin')).toBe('部门管理员');
  });

  it('labels empty roles and server-enforced scopes', () => {
    expect(accessRoleSummary([])).toEqual(['普通用户']);
    expect(accessScopeLabel('tenant', 'finance')).toBe('当前租户');
    expect(accessScopeLabel('department', 'finance')).toBe('finance部门');
  });
});
