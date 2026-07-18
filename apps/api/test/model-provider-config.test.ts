import { describe, expect, it } from 'vitest';

import { parseEnvironment, safeConfigurationSummary } from '../src/config/app-config';

const baseEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://kb:kb@postgres:5432/kb',
  REDIS_URL: 'redis://redis:6379',
  PARSER_WORKER_URL: 'http://parser-worker:8000',
  PARSER_INTERNAL_TOKEN: 'test-internal-token',
  RAW_DOCS_PATH: '/data/raw-docs',
  CHROMA_URL: 'http://chroma:8000',
};

describe('model provider configuration', () => {
  it('keeps LLM and rerank disabled by default', () => {
    expect(parseEnvironment(baseEnvironment)).toMatchObject({
      LLM_PROVIDER: 'none',
      LLM_FALLBACK_PROVIDER: 'none',
      RERANK_PROVIDER: 'none',
      QUERY_RECALL_TOP_K: 20,
      RERANK_TOP_K: 5,
      QUERY_MAX_DISTANCE: 0.45,
      MODEL_PRICING_USD_PER_MILLION_TOKENS_JSON: {},
    });
  });

  it('validates explicit per-model pricing without requiring guessed defaults', () => {
    expect(
      parseEnvironment({
        ...baseEnvironment,
        MODEL_PRICING_USD_PER_MILLION_TOKENS_JSON:
          '{"deepseek:model-a":{"input":1.25,"output":2.5}}',
      }).MODEL_PRICING_USD_PER_MILLION_TOKENS_JSON,
    ).toEqual({ 'deepseek:model-a': { input: 1.25, output: 2.5 } });
    expect(() =>
      parseEnvironment({
        ...baseEnvironment,
        MODEL_PRICING_USD_PER_MILLION_TOKENS_JSON: '{"deepseek:model-a":{"input":-1,"output":2.5}}',
      }),
    ).toThrow('Invalid application configuration: MODEL_PRICING_USD_PER_MILLION_TOKENS_JSON');
  });

  it('rejects inconsistent query retrieval budgets', () => {
    expect(() =>
      parseEnvironment({
        ...baseEnvironment,
        QUERY_RECALL_TOP_K: '4',
        RERANK_TOP_K: '5',
      }),
    ).toThrow('RERANK_TOP_K <= QUERY_RECALL_TOP_K <= CHROMA_QUERY_MAX_TOP_K');
    expect(() =>
      parseEnvironment({
        ...baseEnvironment,
        QUERY_MAX_MERGED_CONTEXT_CHARS: '20000',
        QUERY_MAX_RERANK_INPUT_CHARS: '10000',
      }),
    ).toThrow('QUERY_MAX_MERGED_CONTEXT_CHARS <= QUERY_MAX_RERANK_INPUT_CHARS');
  });

  it('requires the selected LLM model, key and HTTPS endpoint', () => {
    expect(() => parseEnvironment({ ...baseEnvironment, LLM_PROVIDER: 'custom' })).toThrow(
      'Invalid application configuration: LLM_MODEL, CUSTOM_API_KEY, CUSTOM_BASE_URL',
    );
    expect(() =>
      parseEnvironment({
        ...baseEnvironment,
        LLM_PROVIDER: 'custom',
        LLM_MODEL: 'private-model',
        CUSTOM_API_KEY: 'test-key',
        CUSTOM_BASE_URL: 'http://llm.example.test/v1',
      }),
    ).toThrow('Invalid application configuration: CUSTOM_BASE_URL');
  });

  it('supports Alibaba Embedding with DeepSeek LLM and an explicit OpenAI fallback', () => {
    const environment = parseEnvironment({
      ...baseEnvironment,
      EMBEDDING_PROVIDER: 'alibaba',
      EMBEDDING_MODEL: 'text-embedding-v4',
      EMBEDDING_REGION: 'cn-beijing',
      DASHSCOPE_API_KEY: 'dashscope-test-key',
      ALIBABA_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      LLM_PROVIDER: 'deepseek',
      LLM_MODEL: 'configured-deepseek-model',
      DEEPSEEK_API_KEY: 'deepseek-test-key',
      LLM_FALLBACK_PROVIDER: 'openai',
      LLM_FALLBACK_MODEL: 'configured-openai-model',
      OPENAI_API_KEY: 'openai-test-key',
    });

    expect(environment).toMatchObject({
      EMBEDDING_PROVIDER: 'alibaba',
      LLM_PROVIDER: 'deepseek',
      LLM_FALLBACK_PROVIDER: 'openai',
    });
  });

  it('requires qwen3-rerank and its dedicated compatible endpoint', () => {
    expect(() =>
      parseEnvironment({
        ...baseEnvironment,
        RERANK_PROVIDER: 'alibaba',
        DASHSCOPE_API_KEY: 'test-key',
        RERANK_BASE_URL: 'https://example.test/compatible-api/v1',
        RERANK_MODEL: 'gte-rerank-v2',
      }),
    ).toThrow('Invalid application configuration: RERANK_MODEL');
  });

  it('does not expose model credentials in the safe summary', () => {
    const environment = parseEnvironment({
      ...baseEnvironment,
      LLM_PROVIDER: 'google',
      LLM_MODEL: 'configured-gemini-model',
      GEMINI_API_KEY: 'super-secret-gemini-key',
    });
    const summary = JSON.stringify(safeConfigurationSummary(environment));

    expect(summary).not.toContain('super-secret');
    expect(summary).toContain('"llmKeyConfigured":true');
  });
});
