import {
  departmentPolicyListResponseSchema,
  departmentPolicyUpdateRequestSchema,
  departmentPolicyUpdateResponseSchema,
  userRoleUpdateRequestSchema,
  userRoleUpdateResponseSchema,
  managedUserCreateRequestSchema,
  managedUserMutationResponseSchema,
  managedUserDeleteResponseSchema,
  managedUserUpdateRequestSchema,
  userDirectoryQueryRequestSchema,
  userDirectoryQueryResponseSchema,
  type UserDirectoryQueryRequest,
  type UserDirectoryQueryResponse,
  type DepartmentPolicyListResponse,
  type DepartmentPolicyUpdateResponse,
  type AppRole,
  type UserRoleUpdateResponse,
  type ManagedUserCreateRequest,
  type ManagedUserMutationResponse,
  type ManagedUserDeleteResponse,
  type ManagedUserUpdateRequest,
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

export function createUser(
  request: ManagedUserCreateRequest,
): Promise<ManagedUserMutationResponse> {
  const body = managedUserCreateRequestSchema.parse(request);
  return apiRequest('/v1/access/users', managedUserMutationResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function deleteUser(userId: string): Promise<ManagedUserDeleteResponse> {
  return apiRequest(
    `/v1/access/users/${encodeURIComponent(userId)}`,
    managedUserDeleteResponseSchema,
    { method: 'DELETE' },
  );
}

export function updateUser(
  userId: string,
  request: ManagedUserUpdateRequest,
): Promise<ManagedUserMutationResponse> {
  const body = managedUserUpdateRequestSchema.parse(request);
  return apiRequest(
    `/v1/access/users/${encodeURIComponent(userId)}`,
    managedUserMutationResponseSchema,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

export function updateUserRoles(userId: string, roles: AppRole[]): Promise<UserRoleUpdateResponse> {
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
