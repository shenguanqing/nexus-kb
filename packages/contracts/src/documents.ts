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

export const documentFormats = [
  'txt',
  'md',
  'pdf',
  'doc',
  'docx',
  'xlsx',
  'png',
  'jpg',
  'jpeg',
  'dxf',
  'dwg',
] as const;

export const documentFormatSchema = z.enum(documentFormats);

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

export const documentVersionSchema = z
  .object({
    version: z.number().int().positive(),
    status: z.enum([
      'processing',
      'prepared',
      'policy_blocked',
      'active',
      'superseded',
      'failed',
      'deleted',
    ]),
    parser: z.string().nullable(),
    parserVersion: z.string().nullable(),
    warnings: z.array(z.string()),
    chunkCount: z.number().int().nonnegative(),
    vectorCollection: z.string().min(1).max(255).nullable(),
    embeddingFingerprint: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    indexedAt: z.iso.datetime({ offset: true }).nullable(),
    activatedAt: z.iso.datetime({ offset: true }).nullable(),
    supersededAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const documentDetailSchema = z
  .object({
    id: z.uuid(),
    sourceName: z.string().min(1),
    mimeType: z.string().min(1),
    department: z.string().min(1),
    sensitivity: sensitivitySchema,
    ownerId: z.string().min(1),
    activeVersion: z.number().int().positive().nullable(),
    status: documentStatusSchema,
    versions: z.array(documentVersionSchema),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const cadPreviewBoundsSchema = z
  .object({
    minX: z.number().finite(),
    minY: z.number().finite(),
    maxX: z.number().finite(),
    maxY: z.number().finite(),
  })
  .strict()
  .refine((value) => value.maxX > value.minX && value.maxY > value.minY, {
    message: 'CAD preview bounds must have positive dimensions',
  });

export const cadPreviewManifestSchema = z
  .object({
    strategy: z.literal('tiles'),
    tileSize: z.number().int().min(256).max(1024),
    minZoom: z.number().int().min(0).max(15),
    maxZoom: z.number().int().min(0).max(15),
    baseWidth: z.number().int().positive(),
    baseHeight: z.number().int().positive(),
    overviewWidth: z.number().int().positive().max(4096),
    overviewHeight: z.number().int().positive().max(4096),
    bounds: cadPreviewBoundsSchema,
    focusBounds: cadPreviewBoundsSchema.optional(),
    worldToPixel: z.array(z.number().finite()).length(6),
    entityCount: z.number().int().positive().max(2_000_000),
    renderCostScore: z.number().int().positive().max(100_000_000),
  })
  .strict()
  .refine((value) => value.maxZoom >= value.minZoom, {
    message: 'CAD preview zoom range is invalid',
    path: ['maxZoom'],
  })
  .refine(
    (value) =>
      value.focusBounds === undefined ||
      (value.bounds.minX <= value.focusBounds.minX &&
        value.focusBounds.maxX <= value.bounds.maxX &&
        value.bounds.minY <= value.focusBounds.minY &&
        value.focusBounds.maxY <= value.bounds.maxY),
    {
      message: 'CAD preview focus bounds must be contained by full bounds',
      path: ['focusBounds'],
    },
  );

export const documentPreviewSchema = z
  .object({
    documentId: z.uuid(),
    sourceName: z.string().min(1),
    sourceMimeType: z.string().min(1),
    status: z.enum(['ready', 'fallback', 'unavailable']),
    kind: z.enum(['pdf', 'image', 'text', 'markdown', 'svg', 'cad_tiles', 'extracted']).nullable(),
    contentType: z.string().min(1).nullable(),
    renderer: z.string().min(1).max(128).nullable(),
    rendererVersion: z.string().min(1).max(64).nullable(),
    generatedAt: z.iso.datetime({ offset: true }).nullable(),
    fallbackVersion: z.number().int().positive().nullable(),
    cad: cadPreviewManifestSchema.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      (value.kind === 'cad_tiles' && value.cad !== null) ||
      (value.kind !== 'cad_tiles' && value.cad === null),
    {
      message: 'CAD tile preview must include its manifest',
      path: ['cad'],
    },
  );

export const documentChunkListRequestSchema = z
  .object({
    version: z.coerce.number().int().positive().optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const chunkIdSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const documentChunkSchema = z
  .object({
    id: chunkIdSchema,
    documentVersion: z.number().int().positive(),
    ordinal: z.number().int().nonnegative(),
    originalText: z.string(),
    redactedText: z.string(),
    tokenCount: z.number().int().nonnegative(),
    page: z.number().int().nonnegative().nullable(),
    sheet: z.string().min(1).nullable(),
    sectionPath: z.array(z.string()),
    elementTypes: z.array(z.string()),
    previousChunkId: chunkIdSchema.nullable(),
    nextChunkId: chunkIdSchema.nullable(),
    redactionPolicyVersion: z.string().min(1).max(64),
    redactionSummary: z.record(z.string().min(1), z.number().int().nonnegative()),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const documentChunkListResponseSchema = z
  .object({
    documentId: z.uuid(),
    sourceName: z.string().min(1),
    documentVersion: z.number().int().positive(),
    items: z.array(documentChunkSchema).max(100),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive().max(100),
    total: z.number().int().nonnegative(),
  })
  .strict();

export const documentReindexAcceptedSchema = z
  .object({
    documentId: z.uuid(),
    documentVersion: z.number().int().min(2),
    jobId: z.uuid(),
    status: z.literal('queued'),
    traceId: z.uuid(),
  })
  .strict();

export const documentDeleteResponseSchema = z
  .object({ documentId: z.uuid(), deleted: z.literal(true) })
  .strict();

export const documentMetadataUpdateRequestSchema = z
  .object({
    department: z.string().trim().min(1).max(128),
    sensitivity: sensitivitySchema,
  })
  .strict();

export const documentMetadataUpdateAcceptedSchema = z
  .object({
    documentId: z.uuid(),
    documentVersion: z.number().int().min(2),
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
export type DocumentVersion = z.infer<typeof documentVersionSchema>;
export type DocumentDetail = z.infer<typeof documentDetailSchema>;
export type DocumentPreview = z.infer<typeof documentPreviewSchema>;
export type CadPreviewManifest = z.infer<typeof cadPreviewManifestSchema>;
export type DocumentChunkListRequest = z.infer<typeof documentChunkListRequestSchema>;
export type DocumentChunk = z.infer<typeof documentChunkSchema>;
export type DocumentChunkListResponse = z.infer<typeof documentChunkListResponseSchema>;
export type DocumentReindexAccepted = z.infer<typeof documentReindexAcceptedSchema>;
export type DocumentDeleteResponse = z.infer<typeof documentDeleteResponseSchema>;
export type DocumentMetadataUpdateRequest = z.infer<typeof documentMetadataUpdateRequestSchema>;
export type DocumentMetadataUpdateAccepted = z.infer<typeof documentMetadataUpdateAcceptedSchema>;
