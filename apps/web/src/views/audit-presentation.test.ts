import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '@nexus-kb/contracts';

import {
  auditOutcomeLabel,
  auditProvider,
  cloudEgressLabel,
  outcomeTagType,
  visibleAuditAttributes,
} from './audit-presentation';

const event: AuditEvent = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'query',
  event: 'knowledge_query',
  outcome: 'answered',
  traceId: '21111111-1111-4111-8111-111111111111',
  actorUserId: 'user-a',
  documentId: null,
  ingestionJobId: null,
  attributes: {
    queryLength: 12,
    llmProvider: 'deepseek',
    llmModel: 'model-a',
    sourceChunkIds: ['sensitive-chunk-id'],
  },
  createdAt: '2026-07-18T00:00:00.000Z',
};

describe('audit presentation', () => {
  it('renders provider summaries without exposing source chunk identifiers', () => {
    expect(auditProvider(event)).toBe('deepseek / model-a');
    expect(visibleAuditAttributes(event)).toEqual([{ label: '问题长度', value: '12' }]);
  });

  it('identifies embedding usage when retrieval ended before an LLM call', () => {
    const noAnswer: AuditEvent = {
      ...event,
      outcome: 'no_answer',
      attributes: {
        embeddingProvider: 'ollama',
        embeddingModel: 'bge-m3:latest',
      },
    };

    expect(auditProvider(noAnswer)).toBe('Embedding：ollama / bge-m3:latest');
  });

  it('does not infer cloud egress from ordinary query records', () => {
    expect(cloudEgressLabel(event)).toBe('未记录');
    expect(auditOutcomeLabel(event.outcome)).toBe('已回答');
    expect(outcomeTagType(event.outcome)).toBe('success');
  });
});
