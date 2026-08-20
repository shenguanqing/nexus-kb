import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '@nexus-kb/contracts';

import {
  auditEventLabel,
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
    answerMode: 'general',
    llmProvider: 'deepseek',
    llmModel: 'model-a',
    sourceChunkIds: ['sensitive-chunk-id'],
  },
  createdAt: '2026-07-18T00:00:00.000Z',
};

describe('audit presentation', () => {
  it.each([
    ['roles_updated', '用户角色已更新'],
    ['user_created', '用户已创建'],
    ['user_updated', '用户已更新'],
    ['user_deleted', '用户已删除'],
    ['department_policy_updated', '部门策略已更新'],
  ])('renders the access-change action %s in Chinese', (action, label) => {
    expect(
      auditEventLabel({
        ...event,
        type: 'access_change',
        event: action,
      }),
    ).toBe(label);
  });

  it('uses a Chinese fallback for an unknown action', () => {
    expect(auditEventLabel({ ...event, event: 'future_event' })).toBe('未识别操作');
  });

  it('renders provider summaries without exposing source chunk identifiers', () => {
    expect(auditProvider(event)).toBe('LLM：deepseek/model-a');
    expect(visibleAuditAttributes(event)).toEqual([
      { label: '问题长度', value: '12' },
      { label: '回答模式', value: '通用知识补充' },
    ]);
  });

  it('does not substitute embedding details when a query never called an LLM', () => {
    const noAnswer: AuditEvent = {
      ...event,
      outcome: 'no_answer',
      attributes: {
        embeddingProvider: 'ollama',
        embeddingModel: 'bge-m3:latest',
      },
    };

    expect(auditProvider(noAnswer)).toBe('—');
  });

  it('shows only the LLM model for a completed query', () => {
    const answered: AuditEvent = {
      ...event,
      attributes: {
        ...event.attributes,
        embeddingProvider: 'google',
        embeddingModel: 'gemini-embedding-001',
      },
    };

    expect(auditProvider(answered)).toBe('LLM：deepseek/model-a');
  });

  it.each([
    ['ollama', 'bge-m3:latest'],
    ['google', 'gemini-embedding-001'],
  ])('shows %s/%s for an ingestion cloud-policy event', (providerId, embeddingModel) => {
    const policyEvent: AuditEvent = {
      ...event,
      type: 'cloud_policy',
      event: 'cloud_egress_policy',
      attributes: {
        providerId,
        embeddingModel,
      },
    };

    expect(auditProvider(policyEvent)).toBe(`Embedding：${providerId}/${embeddingModel}`);
  });

  it('does not infer cloud egress from ordinary query records', () => {
    expect(cloudEgressLabel(event)).toBe('未记录');
    expect(auditOutcomeLabel(event.outcome)).toBe('已回答');
    expect(outcomeTagType(event.outcome)).toBe('success');
  });
});
