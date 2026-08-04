import { z } from 'zod';

import { appRolesSchema } from './roles';

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
    username: z.string().min(1).max(64).nullable(),
    department: z.string().min(1).max(128),
    roles: appRolesSchema,
    roleSource: z.enum(['identity', 'managed']),
    status: z.enum(['active', 'disabled', 'observed']),
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

export const userRoleUpdateRequestSchema = z.object({ roles: appRolesSchema }).strict();

export const userRoleUpdateResponseSchema = z
  .object({ user: userDirectoryEntrySchema, traceId: z.uuid() })
  .strict();

const usernameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/);

const passwordSchema = z.string().min(12).max(256);
const sensitivityListSchema = z
  .array(z.enum(['public', 'internal', 'confidential']))
  .min(1)
  .max(3);

export const managedUserCreateRequestSchema = z
  .object({
    userId: z.string().trim().min(1).max(256),
    username: usernameSchema,
    password: passwordSchema,
    department: z.string().trim().min(1).max(128),
    roles: appRolesSchema,
    allowedSensitivities: sensitivityListSchema,
    defaultSensitivity: z.enum(['public', 'internal', 'confidential']),
  })
  .strict()
  .refine((value) => value.allowedSensitivities.includes(value.defaultSensitivity), {
    path: ['defaultSensitivity'],
    message: 'must be included in allowedSensitivities',
  });

export const managedUserUpdateRequestSchema = z
  .object({
    department: z.string().trim().min(1).max(128).optional(),
    roles: appRolesSchema.optional(),
    allowedSensitivities: sensitivityListSchema.optional(),
    defaultSensitivity: z.enum(['public', 'internal', 'confidential']).optional(),
    password: passwordSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'must update at least one field')
  .refine(
    (value) =>
      value.allowedSensitivities === undefined ||
      value.defaultSensitivity === undefined ||
      value.allowedSensitivities.includes(value.defaultSensitivity),
    { path: ['defaultSensitivity'], message: 'must be included in allowedSensitivities' },
  );

export const managedUserMutationResponseSchema = z
  .object({ user: userDirectoryEntrySchema, traceId: z.uuid() })
  .strict();

export const managedUserDeleteResponseSchema = z
  .object({ deleted: z.literal(true), traceId: z.uuid() })
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
export type UserRoleUpdateRequest = z.infer<typeof userRoleUpdateRequestSchema>;
export type UserRoleUpdateResponse = z.infer<typeof userRoleUpdateResponseSchema>;
export type ManagedUserCreateRequest = z.infer<typeof managedUserCreateRequestSchema>;
export type ManagedUserUpdateRequest = z.infer<typeof managedUserUpdateRequestSchema>;
export type ManagedUserMutationResponse = z.infer<typeof managedUserMutationResponseSchema>;
export type ManagedUserDeleteResponse = z.infer<typeof managedUserDeleteResponseSchema>;
export type DepartmentPolicy = z.infer<typeof departmentPolicySchema>;
export type DepartmentPolicyListResponse = z.infer<typeof departmentPolicyListResponseSchema>;
export type DepartmentPolicyUpdateRequest = z.infer<typeof departmentPolicyUpdateRequestSchema>;
export type DepartmentPolicyUpdateResponse = z.infer<typeof departmentPolicyUpdateResponseSchema>;
