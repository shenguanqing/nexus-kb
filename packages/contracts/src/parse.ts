import { z } from 'zod';

export const parseRequestSchema = z
  .object({
    jobId: z.uuid(),
    documentId: z.uuid(),
    storagePath: z.string().min(1).max(4096),
    mimeType: z.string().min(1).max(255),
  })
  .strict();

export const parsedElementSchema = z
  .object({
    text: z.string().min(1),
    elementType: z.string().min(1).max(64),
    page: z.number().int().positive().nullable().default(null),
    sheet: z.string().max(255).nullable().default(null),
    sectionPath: z.array(z.string().max(512)).max(64).default([]),
    bbox: z.array(z.number().finite()).length(4).nullable().default(null),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const previewArtifactSchema = z
  .object({
    storageKey: z.string().regex(/^[0-9a-f-]{36}\.(?:pdf|svg)$/),
    kind: z.enum(['pdf', 'svg']),
    mimeType: z.enum(['application/pdf', 'image/svg+xml']),
    sizeBytes: z.number().int().positive().max(1_073_741_824),
    renderer: z.string().min(1).max(128),
    rendererVersion: z.string().min(1).max(64),
  })
  .strict()
  .refine(
    (value) =>
      (value.kind === 'pdf' && value.mimeType === 'application/pdf') ||
      (value.kind === 'svg' && value.mimeType === 'image/svg+xml'),
    { message: 'Preview kind and MIME type must match', path: ['mimeType'] },
  );

export const parseResponseSchema = z
  .object({
    parser: z.string().min(1).max(128),
    parserVersion: z.string().min(1).max(64),
    elements: z.array(parsedElementSchema).max(100_000),
    warnings: z.array(z.string().max(2048)).max(1_000).default([]),
    preview: previewArtifactSchema.nullable().default(null),
  })
  .strict()
  .refine((value) => value.elements.length > 0, {
    message: 'Parser response must contain at least one element',
    path: ['elements'],
  });

export type ParseRequest = z.infer<typeof parseRequestSchema>;
export type ParsedElement = z.infer<typeof parsedElementSchema>;
export type PreviewArtifact = z.infer<typeof previewArtifactSchema>;
export type ParseResponse = z.infer<typeof parseResponseSchema>;
