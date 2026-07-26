const roleLabels: Record<string, string> = {
  user: '普通用户',
  admin: '管理员',
};

export function accessRoleLabel(role: string): string {
  return roleLabels[role] ?? role;
}

export function accessRoleSummary(roles: string[]): string[] {
  return roles.length > 0 ? roles.map(accessRoleLabel) : ['普通用户'];
}

export function accessScopeLabel(scope: 'tenant' | 'department', department: string): string {
  return scope === 'tenant' ? '当前租户' : `${department}部门`;
}
