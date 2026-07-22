import { z } from 'zod';

export const userDirectoryQueryRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(128).optional(),
    department: z.string().trim().min(1).max(128).optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const userDirectoryEntrySchema = z
  .object({
    userId: z.string().min(1).max(256),
    department: z.string().min(1).max(128),
    roles: z.array(z.string().min(1).max(64)).max(32),
    roleSource: z.enum(['identity', 'managed']),
    status: z.literal('observed'),
    lastAuthenticatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const userDirectoryQueryResponseSchema = z
  .object({
    users: z.array(userDirectoryEntrySchema).max(100),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(100),
    scope: z.enum(['tenant', 'department']),
  })
  .strict();

export const managedRoleSchema = z.enum([
  'platform_admin',
  'department_admin',
  'document_admin',
  'auditor',
]);

export const userRoleUpdateRequestSchema = z
  .object({ roles: z.array(managedRoleSchema).max(4) })
  .strict();

export const userRoleUpdateResponseSchema = z
  .object({ user: userDirectoryEntrySchema, traceId: z.uuid() })
  .strict();

export const departmentPolicySchema = z
  .object({
    department: z.string().min(1).max(128),
    allowedSensitivities: z
      .array(z.enum(['public', 'internal', 'confidential']))
      .min(1)
      .max(3),
    userCount: z.number().int().nonnegative(),
    documentCount: z.number().int().nonnegative(),
    managed: z.boolean(),
    updatedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export const departmentPolicyListResponseSchema = z
  .object({ departments: z.array(departmentPolicySchema), scope: z.enum(['tenant', 'department']) })
  .strict();

export const departmentPolicyUpdateRequestSchema = z
  .object({
    allowedSensitivities: z
      .array(z.enum(['public', 'internal', 'confidential']))
      .min(1)
      .max(3),
  })
  .strict();

export const departmentPolicyUpdateResponseSchema = z
  .object({ department: departmentPolicySchema, traceId: z.uuid() })
  .strict();

export type UserDirectoryQueryRequest = z.infer<typeof userDirectoryQueryRequestSchema>;
export type UserDirectoryEntry = z.infer<typeof userDirectoryEntrySchema>;
export type UserDirectoryQueryResponse = z.infer<typeof userDirectoryQueryResponseSchema>;
export type ManagedRole = z.infer<typeof managedRoleSchema>;
export type UserRoleUpdateRequest = z.infer<typeof userRoleUpdateRequestSchema>;
export type UserRoleUpdateResponse = z.infer<typeof userRoleUpdateResponseSchema>;
export type DepartmentPolicy = z.infer<typeof departmentPolicySchema>;
export type DepartmentPolicyListResponse = z.infer<typeof departmentPolicyListResponseSchema>;
export type DepartmentPolicyUpdateRequest = z.infer<typeof departmentPolicyUpdateRequestSchema>;
export type DepartmentPolicyUpdateResponse = z.infer<typeof departmentPolicyUpdateResponseSchema>;
