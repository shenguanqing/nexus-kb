const roleLabels: Record<string, string> = {
  platform_admin: '平台管理员',
  department_admin: '部门管理员',
  document_admin: '文档管理员',
  auditor: '审计员',
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
