import { z } from 'zod';

export const capabilitySchema = z.enum([
  'documents:read',
  'documents:write',
  'documents:delete',
  'audit:read',
  'system:read',
  'access:read',
]);

export const sensitivitySchema = z.enum(['public', 'internal', 'confidential']);

export const authSessionSchema = z
  .object({
    authenticated: z.literal(true),
    mode: z.enum(['development', 'oidc']),
    identity: z
      .object({
        tenantId: z.string().min(1),
        userId: z.string().min(1),
        department: z.string().min(1),
        roles: z.array(z.string()),
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
