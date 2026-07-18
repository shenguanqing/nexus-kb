import { z } from 'zod';

export const providerKindSchema = z.enum(['embedding', 'llm', 'llm_fallback', 'rerank']);
export const providerConfigurationStatusSchema = z.enum(['configured', 'disabled']);

export const providerStatusSchema = z
  .object({
    kind: providerKindSchema,
    provider: z.string().min(1).nullable(),
    model: z.string().min(1).nullable(),
    configurationStatus: providerConfigurationStatusSchema,
    endpointHost: z.string().min(1).nullable(),
    region: z.string().min(1).nullable(),
    dimensions: z.number().int().positive().nullable(),
    credentialConfigured: z.boolean(),
    fingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
  })
  .strict();

export const providerStatusResponseSchema = z
  .object({
    providers: z.array(providerStatusSchema),
    syntheticCheck: z
      .object({
        status: z.literal('not_configured'),
        checkedAt: z.null(),
      })
      .strict(),
  })
  .strict();

export const systemComponentIdSchema = z.enum([
  'api',
  'postgres',
  'redis',
  'chroma',
  'parserWorker',
  'rawDocs',
]);

export const systemStatusResponseSchema = z
  .object({
    status: z.enum(['ready', 'degraded']),
    checkedAt: z.iso.datetime({ offset: true }),
    components: z.array(
      z
        .object({
          id: systemComponentIdSchema,
          status: z.enum(['up', 'down']),
          reason: z.enum(['unavailable', 'unhealthy', 'configuration_mismatch']).nullable(),
        })
        .strict(),
    ),
    ingestionQueue: z
      .object({
        status: z.enum(['up', 'down']),
        waiting: z.number().int().nonnegative().nullable(),
        active: z.number().int().nonnegative().nullable(),
        delayed: z.number().int().nonnegative().nullable(),
        failed: z.number().int().nonnegative().nullable(),
        oldestWaitSeconds: z.number().nonnegative().nullable(),
      })
      .strict(),
    rawDocsDiskUsageRatio: z.number().min(0).max(1).nullable(),
  })
  .strict();

export type ProviderStatus = z.infer<typeof providerStatusSchema>;
export type ProviderStatusResponse = z.infer<typeof providerStatusResponseSchema>;
export type SystemComponentId = z.infer<typeof systemComponentIdSchema>;
export type SystemStatusResponse = z.infer<typeof systemStatusResponseSchema>;
