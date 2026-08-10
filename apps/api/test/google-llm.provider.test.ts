import { describe, expect, it, vi } from 'vitest';

import type { RetrievedChunk } from '../src/knowledge/retrieved-chunk';
import { GoogleLlmProvider } from '../src/providers/llm/google-llm.provider';

const contexts: RetrievedChunk[] = [
  {
    id: 'chunk-a',
    text: '制度正文',
    distance: 0.1,
    metadata: {
      tenantId: 'tenant-a',
      documentId: 'document-a',
      documentVersion: 1,
      chunkId: 'chunk-a',
      sourceName: '制度.md',
      department: 'finance',
      sensitivity: 'internal',
      ownerId: 'owner-a',
    },
  },
];

function provider(overrides: Partial<ConstructorParameters<typeof GoogleLlmProvider>[0]> = {}) {
  return new GoogleLlmProvider({
    apiKey: 'test-key',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'configured-gemini-model',
    region: 'global',
    temperature: 0.2,
    maxOutputTokens: 1200,
    requestTimeoutMs: 1000,
    maxAttempts: 3,
    retryBaseDelayMs: 10,
    ...overrides,
  });
}

describe('GoogleLlmProvider', () => {
  it('uses native generateContent fields and maps usage metadata', async () => {
    const fetchFunction = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '答案。[来源1]' }] } }],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
          },
          responseId: 'response-a',
        }),
      ),
    );
    await expect(
      provider({ fetchFunction }).answer({
        mode: 'grounded',
        question: '问题',
        contexts,
        traceId: 'trace-a',
      }),
    ).resolves.toMatchObject({
      text: '答案。[来源1]',
      requestId: 'response-a',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
    const body = fetchFunction.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') throw new Error('Expected a JSON request body');
    expect(body).toContain('"system_instruction"');
    expect(body).toContain('"generationConfig"');
  });

  it('retries 429 with bounded backoff', async () => {
    const sleepFunction = vi.fn().mockResolvedValue(undefined);
    const fetchFunction = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '答案。[来源1]' }] } }],
          }),
        ),
      );
    await provider({
      fetchFunction,
      sleepFunction,
      randomFunction: () => 0,
    }).answer({ mode: 'grounded', question: '问题', contexts, traceId: 'trace-a' });
    expect(fetchFunction).toHaveBeenCalledTimes(2);
    expect(sleepFunction).toHaveBeenCalledWith(10);
  });

  it('classifies an aborted response body as a retryable timeout', async () => {
    const abortedResponse = {
      ok: true,
      headers: new Headers(),
      json: vi.fn().mockRejectedValue(new DOMException('This operation was aborted', 'AbortError')),
    } as unknown as Response;
    const instance = provider({
      fetchFunction: vi.fn<typeof fetch>().mockResolvedValue(abortedResponse),
      maxAttempts: 1,
    });

    await expect(
      instance.answer({ mode: 'grounded', question: '问题', contexts, traceId: 'trace-a' }),
    ).rejects.toMatchObject({ kind: 'timeout', retryable: true });
  });

  it('omits deprecated sampling parameters for Gemini 3.5 Flash-Lite', async () => {
    const fetchFunction = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: '答案。[来源1]' }] } }] }),
        ),
      );

    await provider({ fetchFunction, model: 'gemini-3.5-flash-lite' }).answer({
      mode: 'grounded',
      question: '问题',
      contexts,
      traceId: 'trace-a',
    });

    const body = fetchFunction.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') throw new Error('Expected a JSON request body');
    expect(body).toContain('"maxOutputTokens"');
    expect(body).not.toContain('"temperature"');
  });

  it('allows a general-knowledge request without source contexts', async () => {
    const fetchFunction = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: '通用回答' }] } }] }),
        ),
      );

    await provider({ fetchFunction }).answer({
      mode: 'general',
      question: 'Vue 是什么？',
      contexts: [],
      traceId: 'trace-a',
    });

    const body = fetchFunction.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') throw new Error('Expected a JSON request body');
    expect(body).toContain('通用知识补充模块');
    expect(body).toContain('知识库助手');
  });
});
