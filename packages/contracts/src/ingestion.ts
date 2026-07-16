import { z } from 'zod';

export const ingestionPayloadSchema = z
  .object({
    ingestionJobId: z.uuid(),
    documentId: z.uuid(),
    storageKey: z.string().regex(/^[0-9a-f-]{36}\.(txt|md|docx|xlsx|dxf)$/i),
  })
  .strict();

export type IngestionPayload = z.infer<typeof ingestionPayloadSchema>;
