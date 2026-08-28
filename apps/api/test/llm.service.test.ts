import { describe, expect, it, vi } from 'vitest';

import type { Identity } from '../src/auth/identity';
import type { OperationalLogger } from '../src/common/operational-logger';
import {
  AnswerCitationError,
  AnswerSourceValidator,
} from '../src/knowledge/answer-source-validator';
import type { KnowledgeContextPolicy } from '../src/knowledge/knowledge-context-policy';
import type { RetrievedChunk } from '../src/knowledge/retrieved-chunk';
import type { LlmProvider } from '../src/providers/llm/llm-provider';
import { LlmProviderError } from '../src/providers/llm/llm-provider-error';
import type { LlmProviderFactory } from '../src/providers/llm/llm-provider.factory';
import { LlmService } from '../src/providers/llm/llm.service';

const identity: Identity = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  department: 'finance',
  roles: ['user'],
  allowedSensitivities: ['public', 'internal', 'confidential'],
  capabilities: ['documents:read'],
  defaultSensitivity: 'internal',
};

const contexts: RetrievedChunk[] = [
  {
    id: 'chunk-a',
    text: 'redacted text',
    distance: 0.1,
    metadata: {
      tenantId: 'tenant-a',
      documentId: 'document-a',
      documentVersion: 1,
      chunkId: 'chunk-a',
      sourceName: 'a.md',
      department: 'finance',
      sensitivity: 'internal',
      ownerId: 'owner-a',
    },
  },
];

function llmProvider(id: string, answer: LlmProvider['answer']): LlmProvider {
  return { id, model: `${id}-model`, region: 'global', answer };
}

describe('LlmService', () => {
  it('uses only an explicitly configured fallback for retryable primary failures', async () => {
    const primaryAnswer = vi
      .fn<LlmProvider['answer']>()
      .mockRejectedValue(new LlmProviderError('unavailable', true));
    const fallbackAnswer = vi
      .fn<LlmProvider['answer']>()
      .mockResolvedValue({ text: '备用答案。[来源1]' });
    const factory = {
      getPrimary: () => llmProvider('deepseek', primaryAnswer),
      getFallback: () => llmProvider('openai', fallbackAnswer),
    } as LlmProviderFactory;
    const contextPolicy = {
      allAllowed: vi.fn().mockReturnValue(true),
    } as unknown as KnowledgeContextPolicy;
    const warn = vi.fn();
    const logger = { warn } as unknown as OperationalLogger;
    const service = new LlmService(factory, contextPolicy, new AnswerSourceValidator(), logger);

    await expect(
      service.answer({ identity, question: '问题', contexts, traceId: 'trace-a' }),
    ).resolves.toMatchObject({
      text: '备用答案。[来源1]',
      provider: 'openai',
      fallbackUsed: true,
    });
    expect(primaryAnswer).toHaveBeenCalledTimes(1);
    expect(fallbackAnswer).toHaveBeenCalledTimes(1);
  });

  it('fails closed before any provider call when ACL or cloud policy rejects a context', async () => {
    const answer = vi.fn<LlmProvider['answer']>();
    const factory = {
      getPrimary: () => llmProvider('deepseek', answer),
      getFallback: () => null,
    } as LlmProviderFactory;
    const contextPolicy = {
      allAllowed: vi.fn().mockReturnValue(false),
    } as unknown as KnowledgeContextPolicy;
    const service = new LlmService(factory, contextPolicy, new AnswerSourceValidator(), {
      warn: vi.fn(),
    } as unknown as OperationalLogger);

    await expect(
      service.answer({ identity, question: '问题', contexts, traceId: 'trace-a' }),
    ).rejects.toMatchObject({
      kind: 'policy_denied',
    });
    expect(answer).not.toHaveBeenCalled();
  });

  it('does not fallback for authentication or invalid request failures', async () => {
    const fallbackAnswer = vi.fn<LlmProvider['answer']>();
    const factory = {
      getPrimary: () =>
        llmProvider(
          'deepseek',
          vi.fn().mockRejectedValue(new LlmProviderError('authentication', false)),
        ),
      getFallback: () => llmProvider('openai', fallbackAnswer),
    } as LlmProviderFactory;
    const service = new LlmService(
      factory,
      { allAllowed: vi.fn().mockReturnValue(true) } as unknown as KnowledgeContextPolicy,
      new AnswerSourceValidator(),
      {
        warn: vi.fn(),
      } as unknown as OperationalLogger,
    );

    await expect(
      service.answer({ identity, question: '问题', contexts, traceId: 'trace-a' }),
    ).rejects.toMatchObject({
      kind: 'authentication',
    });
    expect(fallbackAnswer).not.toHaveBeenCalled();
  });

  it('retries once with an explicit citation-repair instruction', async () => {
    const answer = vi
      .fn<LlmProvider['answer']>()
      .mockResolvedValueOnce({ text: 'Vue 3 使用 Proxy。' })
      .mockResolvedValueOnce({ text: 'Vue 3 使用 Proxy。[来源1]' });
    const factory = {
      getPrimary: () => llmProvider('google', answer),
      getFallback: () => null,
    } as LlmProviderFactory;
    const repairWarn = vi.fn();
    const logger = { warn: repairWarn } as unknown as OperationalLogger;
    const service = new LlmService(
      factory,
      { allAllowed: vi.fn().mockReturnValue(true) } as unknown as KnowledgeContextPolicy,
      new AnswerSourceValidator(),
      logger,
    );

    await expect(
      service.answer({ identity, question: 'Vue 2 和 Vue 3 的区别', contexts, traceId: 'trace-a' }),
    ).resolves.toMatchObject({
      text: 'Vue 3 使用 Proxy。[来源1]',
      provider: 'google',
      fallbackUsed: false,
    });
    expect(answer).toHaveBeenCalledTimes(2);
    expect(answer).toHaveBeenNthCalledWith(2, expect.objectContaining({ citationRepair: true }));
    expect(repairWarn).toHaveBeenCalledWith(
      'llm_citation_repair_retry',
      expect.objectContaining({ traceId: 'trace-a', status: 'missing' }),
    );
  });

  it('does not spend a repair call when the grounded model explicitly reports insufficient data', async () => {
    const answer = vi.fn<LlmProvider['answer']>().mockResolvedValue({ text: '资料不足' });
    const factory = {
      getPrimary: () => llmProvider('deepseek', answer),
      getFallback: () => null,
    } as LlmProviderFactory;
    const info = vi.fn();
    const service = new LlmService(
      factory,
      { allAllowed: vi.fn().mockReturnValue(true) } as unknown as KnowledgeContextPolicy,
      new AnswerSourceValidator(),
      { info, warn: vi.fn() } as unknown as OperationalLogger,
    );

    await expect(
      service.answer({ identity, question: '问题', contexts, traceId: 'trace-a' }),
    ).rejects.toMatchObject({ reason: 'insufficient' });
    expect(answer).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith(
      'llm_grounded_context_insufficient',
      expect.objectContaining({ traceId: 'trace-a', status: 'insufficient' }),
    );
  });

  it('still fails closed after one unsuccessful citation-repair attempt', async () => {
    const answer = vi.fn<LlmProvider['answer']>().mockResolvedValue({ text: '没有引用的答案。' });
    const factory = {
      getPrimary: () => llmProvider('google', answer),
      getFallback: () => null,
    } as LlmProviderFactory;
    const service = new LlmService(
      factory,
      { allAllowed: vi.fn().mockReturnValue(true) } as unknown as KnowledgeContextPolicy,
      new AnswerSourceValidator(),
      {
        warn: vi.fn(),
      } as unknown as OperationalLogger,
    );

    await expect(
      service.answer({ identity, question: '问题', contexts, traceId: 'trace-a' }),
    ).rejects.toBeInstanceOf(AnswerCitationError);
    expect(answer).toHaveBeenCalledTimes(2);
  });

  it('answers from general knowledge without contexts and removes fake source markers', async () => {
    const answer = vi
      .fn<LlmProvider['answer']>()
      .mockResolvedValue({ text: 'Vue 3 使用 Proxy。[来源1]' });
    const factory = {
      getPrimary: () => llmProvider('google', answer),
      getFallback: () => null,
    } as LlmProviderFactory;
    const canSendQuestion = vi.fn().mockReturnValue(true);
    const service = new LlmService(
      factory,
      { canSendQuestion } as unknown as KnowledgeContextPolicy,
      new AnswerSourceValidator(),
      { warn: vi.fn() } as unknown as OperationalLogger,
    );

    await expect(
      service.answerGeneral({
        identity,
        question: 'Vue 2 和 Vue 3 的区别',
        traceId: 'trace-a',
      }),
    ).resolves.toMatchObject({
      text: 'Vue 3 使用 Proxy。',
      provider: 'google',
      fallbackUsed: false,
    });
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ mode: 'general', contexts: [] }));
    expect(canSendQuestion).toHaveBeenCalledOnce();
  });

  it('blocks a general answer before provider invocation when question egress is denied', async () => {
    const answer = vi.fn<LlmProvider['answer']>();
    const factory = {
      getPrimary: () => llmProvider('google', answer),
      getFallback: () => null,
    } as LlmProviderFactory;
    const service = new LlmService(
      factory,
      { canSendQuestion: vi.fn().mockReturnValue(false) } as unknown as KnowledgeContextPolicy,
      new AnswerSourceValidator(),
      {
        warn: vi.fn(),
      } as unknown as OperationalLogger,
    );

    await expect(
      service.answerGeneral({ identity, question: '问题', traceId: 'trace-a' }),
    ).rejects.toMatchObject({
      kind: 'policy_denied',
    });
    expect(answer).not.toHaveBeenCalled();
  });

  it('rejects a general response that becomes empty after fake citations are removed', async () => {
    const factory = {
      getPrimary: () =>
        llmProvider(
          'google',
          vi.fn<LlmProvider['answer']>().mockResolvedValue({ text: '[来源1]' }),
        ),
      getFallback: () => null,
    } as LlmProviderFactory;
    const service = new LlmService(
      factory,
      { canSendQuestion: vi.fn().mockReturnValue(true) } as unknown as KnowledgeContextPolicy,
      new AnswerSourceValidator(),
      {
        warn: vi.fn(),
      } as unknown as OperationalLogger,
    );

    await expect(
      service.answerGeneral({ identity, question: '问题', traceId: 'trace-a' }),
    ).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });
});
