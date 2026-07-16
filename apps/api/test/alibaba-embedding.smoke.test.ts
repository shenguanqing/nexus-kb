import { describe, expect, it } from 'vitest';

import { AlibabaEmbeddingProvider } from '../src/providers/embedding/alibaba-embedding.provider';

const shouldRun = process.env.RUN_PAID_PROVIDER_TESTS === 'true';

describe.skipIf(!shouldRun)('Alibaba embedding paid smoke test', () => {
  it('embeds one document and one query with the configured vector dimension', async () => {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    const baseUrl = process.env.ALIBABA_BASE_URL;
    if (!apiKey || !baseUrl) {
      throw new Error('DASHSCOPE_API_KEY and ALIBABA_BASE_URL are required for paid smoke tests');
    }
    const dimensions = Number(process.env.EMBEDDING_DIMENSIONS ?? 1024);
    const provider = new AlibabaEmbeddingProvider({
      apiKey,
      baseUrl,
      model: process.env.EMBEDDING_MODEL ?? 'text-embedding-v4',
      dimensions,
      batchSize: 2,
      region: process.env.EMBEDDING_REGION ?? 'cn-beijing',
      requestTimeoutMs: 60_000,
      maxAttempts: 2,
      retryBaseDelayMs: 500,
    });

    const documents = await provider.embedDocuments(['NexusKB 脱敏测试文档']);
    const query = await provider.embedQuery('如何验证知识库？');

    expect(documents).toHaveLength(1);
    expect(documents[0]).toHaveLength(dimensions);
    expect(query).toHaveLength(dimensions);
  }, 120_000);
});
