import { z } from 'zod';

import { sensitivitySchema } from './auth-session';

export const documentStatusSchema = z.enum([
  'uploaded',
  'processing',
  'prepared',
  'active',
  'policy_blocked',
  'failed',
  'deleting',
  'deleted',
]);

export const documentFormatSchema = z.enum(['txt', 'md', 'docx', 'xlsx', 'dxf', 'dwg']);

export const documentListRequestSchema = z
  .object({
    search: z
      .string()
      .trim()
      .max(200)
      .transform((value) => value.normalize('NFC'))
      .optional(),
    department: z.string().trim().min(1).max(128).optional(),
    sensitivity: sensitivitySchema.optional(),
    status: documentStatusSchema.exclude(['deleting', 'deleted']).optional(),
    format: documentFormatSchema.optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const latestIngestionJobSchema = z
  .object({
    id: z.uuid(),
    status: z.string().min(1),
    step: z.string().min(1),
    attempts: z.number().int().nonnegative(),
    retryable: z.boolean(),
    errorCode: z.string().nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const documentListItemSchema = z
  .object({
    id: z.uuid(),
    sourceName: z.string().min(1),
    mimeType: z.string().min(1),
    department: z.string().min(1),
    sensitivity: sensitivitySchema,
    ownerId: z.string().min(1),
    activeVersion: z.number().int().positive().nullable(),
    status: documentStatusSchema,
    latestJob: latestIngestionJobSchema.nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const documentListResponseSchema = z
  .object({
    items: z.array(documentListItemSchema).max(100),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive().max(100),
    total: z.number().int().nonnegative(),
  })
  .strict();

export const documentUploadOptionsSchema = z
  .object({
    maxUploadBytes: z.number().int().positive(),
    acceptedExtensions: z.array(documentFormatSchema).min(1),
    department: z.string().min(1),
    allowedSensitivities: z.array(sensitivitySchema).min(1),
    defaultSensitivity: sensitivitySchema,
    dwgConversionEnabled: z.boolean(),
  })
  .strict();

export const documentUploadAcceptedSchema = z
  .object({
    documentId: z.uuid(),
    jobId: z.uuid(),
    status: z.literal('queued'),
    traceId: z.uuid(),
  })
  .strict();

export type DocumentListRequest = z.infer<typeof documentListRequestSchema>;
export type DocumentListItem = z.infer<typeof documentListItemSchema>;
export type DocumentListResponse = z.infer<typeof documentListResponseSchema>;
export type DocumentUploadOptions = z.infer<typeof documentUploadOptionsSchema>;
export type DocumentUploadAccepted = z.infer<typeof documentUploadAcceptedSchema>;
