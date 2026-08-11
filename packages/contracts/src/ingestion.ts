import { z } from 'zod';

import { documentFormats } from './documents';

const storageKeyPattern = new RegExp(`^[0-9a-f-]{36}\\.(${documentFormats.join('|')})$`, 'i');

export const ingestionPayloadSchema = z
  .object({
    ingestionJobId: z.uuid(),
    documentId: z.uuid(),
    storageKey: z.string().regex(storageKeyPattern),
  })
  .strict();

export type IngestionPayload = z.infer<typeof ingestionPayloadSchema>;

export const ingestionStatusSchema = z.enum([
  'queued',
  'converting',
  'parsing',
  'chunking',
  'policy_check',
  'embedding',
  'indexing',
  'policy_blocked',
  'completed',
  'failed',
  'deleted',
]);

export const ingestionJobSchema = z
  .object({
    id: z.uuid(),
    documentId: z.uuid(),
    sourceName: z.string().min(1),
    mimeType: z.string().min(1),
    version: z.number().int().positive(),
    kind: z.enum(['ingestion', 'reindex', 'index_migration']),
    status: ingestionStatusSchema,
    step: z.string().min(1),
    checkpoint: z.string().min(1),
    attempts: z.number().int().nonnegative(),
    traceId: z.uuid(),
    parserVersion: z.string().nullable(),
    embeddingFingerprint: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    embeddingCompletedChunks: z.number().int().nonnegative(),
    embeddingTotalChunks: z.number().int().nonnegative().nullable(),
    embeddingBatchSize: z.number().int().positive().nullable(),
    warnings: z.array(z.string()),
    errorCode: z.string().nullable(),
    errorCategory: z.string().nullable(),
    retryable: z.boolean(),
    startedAt: z.iso.datetime({ offset: true }).nullable(),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const ingestionJobListRequestSchema = z
  .object({
    documentId: z.uuid().optional(),
    status: ingestionStatusSchema.exclude(['deleted']).optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const ingestionJobListResponseSchema = z
  .object({
    items: z.array(ingestionJobSchema).max(100),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive().max(100),
    total: z.number().int().nonnegative(),
  })
  .strict();

export const ingestionRetryAcceptedSchema = z
  .object({
    jobId: z.uuid(),
    status: z.literal('queued'),
    traceId: z.uuid(),
  })
  .strict();

export type IngestionStatus = z.infer<typeof ingestionStatusSchema>;
export type IngestionJob = z.infer<typeof ingestionJobSchema>;
export type IngestionJobListRequest = z.infer<typeof ingestionJobListRequestSchema>;
export type IngestionJobListResponse = z.infer<typeof ingestionJobListResponseSchema>;
export type IngestionRetryAccepted = z.infer<typeof ingestionRetryAcceptedSchema>;
