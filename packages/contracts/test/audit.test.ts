import { describe, expect, it } from 'vitest';

import { auditQueryRequestSchema, auditQueryResponseSchema } from '../src/audit';

const id = 'd26720b3-1f78-40df-868d-8ca8510dca26';

describe('audit contracts', () => {
  it('coerces bounded query parameters', () => {
    expect(auditQueryRequestSchema.parse({ type: 'query', limit: '25' })).toEqual({
      type: 'query',
      limit: 25,
    });
    expect(auditQueryRequestSchema.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('accepts structured events without question, answer, or document text', () => {
    const response = auditQueryResponseSchema.parse({
      events: [
        {
          id,
          type: 'query',
          event: 'knowledge_query',
          outcome: 'answered',
          traceId: id,
          actorUserId: 'user-a',
          documentId: null,
          ingestionJobId: null,
          attributes: {
            queryLength: 8,
            sourceChunkIds: ['a'.repeat(64)],
            errorCode: null,
          },
          createdAt: '2026-07-18T00:00:00.000Z',
        },
      ],
      nextBefore: null,
      total: 1,
    });

    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain('"question":');
    expect(serialized).not.toContain('"answer":');
    expect(serialized).not.toContain('"documentText":');
  });
});
