import {
  departmentPolicyListResponseSchema,
  departmentPolicyUpdateRequestSchema,
  departmentPolicyUpdateResponseSchema,
  userRoleUpdateRequestSchema,
  userRoleUpdateResponseSchema,
  userDirectoryQueryRequestSchema,
  userDirectoryQueryResponseSchema,
  type UserDirectoryQueryRequest,
  type UserDirectoryQueryResponse,
  type DepartmentPolicyListResponse,
  type DepartmentPolicyUpdateResponse,
  type ManagedRole,
  type UserRoleUpdateResponse,
} from '@nexus-kb/contracts';

import { apiRequest } from './client';

export function listUsers(
  request: Partial<UserDirectoryQueryRequest>,
): Promise<UserDirectoryQueryResponse> {
  const query = userDirectoryQueryRequestSchema.parse(request);
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) parameters.set(key, String(value));
  }
  return apiRequest(`/v1/access/users?${parameters.toString()}`, userDirectoryQueryResponseSchema);
}

export function updateUserRoles(
  userId: string,
  roles: ManagedRole[],
): Promise<UserRoleUpdateResponse> {
  const body = userRoleUpdateRequestSchema.parse({ roles });
  return apiRequest(
    `/v1/access/users/${encodeURIComponent(userId)}/roles`,
    userRoleUpdateResponseSchema,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

export function listDepartments(): Promise<DepartmentPolicyListResponse> {
  return apiRequest('/v1/access/departments', departmentPolicyListResponseSchema);
}

export function updateDepartmentPolicy(
  department: string,
  allowedSensitivities: Array<'public' | 'internal' | 'confidential'>,
): Promise<DepartmentPolicyUpdateResponse> {
  const body = departmentPolicyUpdateRequestSchema.parse({ allowedSensitivities });
  return apiRequest(
    `/v1/access/departments/${encodeURIComponent(department)}`,
    departmentPolicyUpdateResponseSchema,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}
