import { z } from 'zod';

export const usageQueryRequestSchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine((value) => value.from <= value.to, 'invalid time range');

export const usageProviderRowSchema = z
  .object({
    kind: z.enum(['embedding', 'rerank', 'llm']),
    provider: z.string().min(1),
    model: z.string().min(1),
    requests: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    estimatedCostUsd: z.number().nonnegative().nullable(),
  })
  .strict();

export const usageDepartmentRowSchema = z
  .object({
    department: z.string().min(1),
    requests: z.number().int().positive(),
  })
  .strict();

export const usageResponseSchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    totalQueries: z.number().int().nonnegative(),
    failureRate: z.number().min(0).max(1).nullable(),
    queryP50Ms: z.number().int().nonnegative().nullable(),
    queryP95Ms: z.number().int().nonnegative().nullable(),
    providers: z.array(usageProviderRowSchema),
    departments: z.array(usageDepartmentRowSchema),
    usageCompleteness: z.enum(['request_only', 'tokens_and_cost']),
  })
  .strict();

export type UsageQueryRequest = z.infer<typeof usageQueryRequestSchema>;
export type UsageResponse = z.infer<typeof usageResponseSchema>;
