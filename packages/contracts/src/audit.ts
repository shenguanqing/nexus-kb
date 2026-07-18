import { z } from 'zod';

export const auditEventTypeSchema = z.enum(['query', 'document_lifecycle', 'cloud_policy']);

export const auditQueryRequestSchema = z
  .object({
    type: auditEventTypeSchema.optional(),
    before: z.iso.datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

const auditAttributeSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
]);

export const auditEventSchema = z
  .object({
    id: z.uuid(),
    type: auditEventTypeSchema,
    event: z.string().min(1).max(128),
    outcome: z.string().min(1).max(128),
    traceId: z.uuid().nullable(),
    actorUserId: z.string().nullable(),
    documentId: z.uuid().nullable(),
    ingestionJobId: z.uuid().nullable(),
    attributes: z.record(z.string(), auditAttributeSchema),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const auditQueryResponseSchema = z
  .object({
    events: z.array(auditEventSchema).max(100),
    nextBefore: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export type AuditEventType = z.infer<typeof auditEventTypeSchema>;
export type AuditQueryRequest = z.infer<typeof auditQueryRequestSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type AuditQueryResponse = z.infer<typeof auditQueryResponseSchema>;
