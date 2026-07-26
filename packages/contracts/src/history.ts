import { z } from 'zod';

export const conversationListRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(200).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, 'invalid time range');

export const conversationSummarySchema = z
  .object({
    id: z.uuid(),
    title: z.string().min(1).max(200),
    messageCount: z.number().int().nonnegative(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const conversationListResponseSchema = z
  .object({
    conversations: z.array(conversationSummarySchema).max(100),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(100),
  })
  .strict();

export const conversationTurnSchema = z
  .object({
    id: z.uuid(),
    question: z.string().min(1).max(2000),
    answer: z.string().min(1),
    noAnswer: z.boolean(),
    reason: z.enum(['insufficient_relevance', 'authorization_changed']).nullable(),
    answerMode: z.enum(['grounded', 'general']).nullable(),
    traceId: z.uuid(),
    sourceCount: z.number().int().nonnegative(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const conversationDetailSchema = conversationSummarySchema
  .extend({ turns: z.array(conversationTurnSchema).max(500) })
  .strict();

export const conversationDeleteResponseSchema = z
  .object({ conversationId: z.uuid(), deleted: z.literal(true) })
  .strict();

export type ConversationListRequest = z.infer<typeof conversationListRequestSchema>;
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;
export type ConversationTurn = z.infer<typeof conversationTurnSchema>;
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;
export type ConversationDeleteResponse = z.infer<typeof conversationDeleteResponseSchema>;
