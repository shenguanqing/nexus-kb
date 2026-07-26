import { z } from 'zod';

function containsForbiddenControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (codePoint < 32 && ![9, 10, 13].includes(codePoint)) || codePoint === 127;
  });
}

export const knowledgeQueryRequestSchema = z
  .object({
    conversationId: z.uuid().optional(),
    question: z
      .string()
      .trim()
      .min(2)
      .max(2000)
      .refine((value) => !containsForbiddenControlCharacter(value), 'contains control characters')
      .transform((value) => value.normalize('NFC')),
  })
  .strict();

export const knowledgeSourceSchema = z
  .object({
    index: z.number().int().positive(),
    documentId: z.uuid(),
    documentVersion: z.number().int().positive(),
    chunkIds: z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(1),
    sourceName: z.string().min(1),
    page: z.number().int().positive().nullable(),
    sheet: z.string().nullable(),
    sectionPath: z.array(z.string()),
  })
  .strict();

export const knowledgeQueryResponseSchema = z
  .object({
    conversationId: z.uuid(),
    answer: z.string().min(1),
    noAnswer: z.boolean(),
    reason: z.enum(['insufficient_relevance', 'authorization_changed']).nullable(),
    answerMode: z.enum(['grounded', 'general']).nullable(),
    traceId: z.uuid(),
    sources: z.array(knowledgeSourceSchema),
    model: z
      .object({
        provider: z.string().min(1),
        model: z.string().min(1),
        fallbackUsed: z.boolean(),
      })
      .strict()
      .nullable(),
    rerankDegraded: z.boolean(),
  })
  .strict()
  .superRefine((response, context) => {
    const invalidNoAnswer =
      response.noAnswer &&
      (response.reason === null ||
        response.answerMode !== null ||
        response.sources.length > 0 ||
        response.model !== null);
    const invalidGroundedAnswer =
      !response.noAnswer &&
      response.answerMode === 'grounded' &&
      (response.reason !== null || response.sources.length === 0 || response.model === null);
    const invalidGeneralAnswer =
      !response.noAnswer &&
      response.answerMode === 'general' &&
      (response.reason !== null || response.sources.length > 0 || response.model === null);
    const missingAnswerMode = !response.noAnswer && response.answerMode === null;
    if (
      invalidNoAnswer ||
      invalidGroundedAnswer ||
      invalidGeneralAnswer ||
      missingAnswerMode
    ) {
      context.addIssue({ code: 'custom', message: 'answer state is inconsistent' });
    }
  });

export type KnowledgeQueryRequest = z.infer<typeof knowledgeQueryRequestSchema>;
export type KnowledgeQueryResponse = z.infer<typeof knowledgeQueryResponseSchema>;
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;
