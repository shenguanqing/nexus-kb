import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../src/config/app-config';
import { CloudPolicyService } from '../src/ingestion/cloud-policy';
import type { EmbeddingProvider } from '../src/providers/embedding/embedding-provider';
import type { EmbeddingProviderFactory } from '../src/providers/embedding/embedding-provider.factory';
import { EmbeddingService } from '../src/providers/embedding/embedding.service';

function policyConfig(): AppConfig {
  return {
    values: {
      ALLOW_CONFIDENTIAL_TO_CLOUD: false,
      CLOUD_EGRESS_RULES_JSON: [],
    },
  } as unknown as AppConfig;
}

function provider() {
  const embedDocuments = vi
    .fn<EmbeddingProvider['embedDocuments']>()
    .mockResolvedValue([[0, 1, 2]]);
  const embedQuery = vi.fn<EmbeddingProvider['embedQuery']>().mockResolvedValue([0, 1, 2]);
  return {
    embeddingProvider: {
      id: 'alibaba',
      model: 'text-embedding-v4',
      dimensions: 3,
      region: 'cn-beijing',
      taskMode: 'symmetric',
      embedDocuments,
      embedQuery,
    } satisfies EmbeddingProvider,
    embedDocuments,
    embedQuery,
  };
}

describe('EmbeddingService', () => {
  it('blocks confidential content before invoking the configured provider', async () => {
    const { embeddingProvider, embedDocuments } = provider();
    const factory = {
      getProvider: () => embeddingProvider,
    } as EmbeddingProviderFactory;
    const service = new EmbeddingService(factory, new CloudPolicyService(policyConfig()));

    await expect(
      service.embedDocuments(['confidential text'], { sensitivity: 'confidential' }),
    ).rejects.toMatchObject({ kind: 'policy_denied' });
    expect(embedDocuments).not.toHaveBeenCalled();
  });

  it('uses separate document and query operations for allowed content', async () => {
    const { embeddingProvider, embedDocuments, embedQuery } = provider();
    const factory = {
      getProvider: () => embeddingProvider,
    } as EmbeddingProviderFactory;
    const service = new EmbeddingService(factory, new CloudPolicyService(policyConfig()));

    await expect(
      service.embedDocuments(['internal text'], { sensitivity: 'internal' }),
    ).resolves.toEqual([[0, 1, 2]]);
    await expect(service.embedQuery('question', { sensitivity: 'internal' })).resolves.toEqual([
      0, 1, 2,
    ]);
    expect(embedDocuments).toHaveBeenCalledOnce();
    expect(embedQuery).toHaveBeenCalledOnce();
  });
});
