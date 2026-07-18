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

export type UserDirectoryQueryRequest = z.infer<typeof userDirectoryQueryRequestSchema>;
export type UserDirectoryEntry = z.infer<typeof userDirectoryEntrySchema>;
export type UserDirectoryQueryResponse = z.infer<typeof userDirectoryQueryResponseSchema>;
