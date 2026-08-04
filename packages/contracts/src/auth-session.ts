import { z } from 'zod';

import { appRolesSchema } from './roles';

export const capabilitySchema = z.enum([
  'documents:read',
  'documents:write',
  'documents:delete',
  'audit:read',
  'system:read',
  'system:configure',
  'system:deploy',
  'access:read',
  'access:write',
]);

export const sensitivitySchema = z.enum(['public', 'internal', 'confidential']);

export const authModeSchema = z.enum(['development', 'password', 'oidc']);

export const passwordLoginRequestSchema = z
  .object({
    username: z.string().trim().min(1).max(64),
    password: z.string().min(1).max(256),
  })
  .strict();

export const authLoginOptionsSchema = z
  .object({
    mode: authModeSchema,
    passwordEnabled: z.boolean(),
  })
  .strict();

export const authLogoutResponseSchema = z.object({ loggedOut: z.literal(true) }).strict();

export const authSessionSchema = z
  .object({
    authenticated: z.literal(true),
    mode: authModeSchema,
    identity: z
      .object({
        tenantId: z.string().min(1),
        userId: z.string().min(1),
        department: z.string().min(1),
        roles: appRolesSchema,
        allowedSensitivities: z.array(sensitivitySchema).min(1),
        capabilities: z.array(capabilitySchema),
        defaultSensitivity: sensitivitySchema,
      })
      .strict(),
  })
  .strict();

export type AuthSession = z.infer<typeof authSessionSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
export type Sensitivity = z.infer<typeof sensitivitySchema>;
export type AuthMode = z.infer<typeof authModeSchema>;
export type PasswordLoginRequest = z.infer<typeof passwordLoginRequestSchema>;
export type AuthLoginOptions = z.infer<typeof authLoginOptionsSchema>;
export type AuthLogoutResponse = z.infer<typeof authLogoutResponseSchema>;
