import { z } from 'zod';
import { knowledgeSourceSchema } from './knowledge-query';

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

const LEGACY_SOURCE_UNAVAILABLE_TEXT = '该历史回答的来源尚未完成重新鉴权，请刷新后重试。';

export const conversationTurnSchema = z
  .object({
    id: z.uuid(),
    question: z.string().min(1).max(2000),
    answer: z.string().min(1),
    noAnswer: z.boolean(),
    reason: z.enum(['insufficient_relevance', 'authorization_changed']).nullable(),
    answerMode: z.enum(['grounded', 'general']).nullable(),
    traceId: z.uuid(),
    sources: z.array(knowledgeSourceSchema).max(100).optional(),
    sourceCount: z.number().int().nonnegative(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .transform((turn) => {
    if (turn.sources === undefined && turn.answerMode === 'grounded') {
      return {
        ...turn,
        answer: LEGACY_SOURCE_UNAVAILABLE_TEXT,
        noAnswer: true,
        reason: 'authorization_changed' as const,
        answerMode: null,
        sources: [],
        sourceCount: 0,
      };
    }
    return { ...turn, sources: turn.sources ?? [] };
  });

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
