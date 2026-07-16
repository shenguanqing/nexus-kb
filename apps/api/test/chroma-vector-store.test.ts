import { describe, expect, it, vi } from 'vitest';
import type { Collection, Metadata } from 'chromadb';

import type { AppConfig } from '../src/config/app-config';
import type { EmbeddingProviderFactory } from '../src/providers/embedding/embedding-provider.factory';
import { ChromaVectorStore } from '../src/vector-store/chroma-vector-store';
import type { VectorChunk } from '../src/vector-store/vector-store';

function config(provider: 'none' | 'alibaba' = 'alibaba'): AppConfig {
  return {
    values: {
      CHROMA_URL: 'http://chroma:8000',
      CHROMA_TENANT: 'default_tenant',
      CHROMA_DATABASE: 'default_database',
      CHROMA_COLLECTION_PREFIX: 'nexuskbtest',
      CHROMA_SCHEMA_VERSION: 1,
      CHROMA_UPSERT_BATCH_SIZE: 2,
      CHROMA_QUERY_MAX_TOP_K: 20,
      EMBEDDING_PROVIDER: provider,
      EMBEDDING_MODEL: 'text-embedding-v4',
      EMBEDDING_DIMENSIONS: 3,
    },
  } as unknown as AppConfig;
}

function embeddingFactory(): EmbeddingProviderFactory {
  return {
    getFingerprint: () => ({
      value: 'a'.repeat(64),
      configuration: {
        schemaVersion: 1,
        provider: 'alibaba',
        model: 'text-embedding-v4',
        dimensions: 3,
        taskMode: 'symmetric',
        chunkMaxTokens: 600,
        chunkOverlapTokens: 80,
        redactionPolicyVersion: 'v1',
      },
    }),
  } as EmbeddingProviderFactory;
}

function chunk(id: string, tenantId = 'tenant-a'): VectorChunk {
  return {
    id,
    tenantId,
    documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
    documentVersion: 1,
    ordinal: 0,
    redactedText: '脱敏后的正文',
    sourceName: 'policy.md',
    page: 2,
    sheet: null,
    sectionPath: ['付款制度'],
    department: 'finance',
    sensitivity: 'internal',
    ownerId: 'user-a',
    previousChunkId: null,
    nextChunkId: null,
  };
}

function chromaPorts(options: { metadataMismatch?: boolean } = {}) {
  const metadata: Metadata = {};
  const upsert = vi.fn<Collection['upsert']>().mockResolvedValue(undefined);
  const get = vi.fn<Collection['get']>((args) =>
    Promise.resolve({
      ids: args?.ids ?? [],
      embeddings: null,
      documents: [],
      metadatas: [],
      uris: null,
      include: [],
    }),
  );
  const query = vi.fn<Collection['query']>().mockResolvedValue({
    ids: [['chunk-a']],
    embeddings: null,
    documents: [['脱敏后的正文']],
    metadatas: [[{ tenantId: 'tenant-a', documentId: 'document-a' }]],
    distances: [[0.1]],
    uris: null,
    include: ['documents', 'metadatas', 'distances'],
  });
  const deleteRecords = vi.fn<Collection['delete']>().mockResolvedValue({});
  const collection = {
    configuration: { hnsw: { space: 'cosine' } },
    metadata,
    upsert,
    get,
    query,
    delete: deleteRecords,
  };
  const getOrCreateCollection = vi.fn((input: { metadata?: Metadata }) => {
    collection.metadata = options.metadataMismatch
      ? { ...input.metadata, fingerprint: 'wrong' }
      : (input.metadata ?? {});
    return Promise.resolve(collection);
  });
  return {
    client: {
      heartbeat: vi.fn().mockResolvedValue(1),
      version: vi.fn().mockResolvedValue('1.5.9'),
      getOrCreateCollection,
    },
    collection,
    upsert,
    get,
    query,
    deleteRecords,
    getOrCreateCollection,
  };
}

describe('ChromaVectorStore', () => {
  it('keeps Chroma connectivity enabled while collection creation waits for embedding config', async () => {
    const ports = chromaPorts();
    const store = new ChromaVectorStore(config('none'), embeddingFactory(), ports.client);

    expect(store.info()).toEqual({ enabled: false, collectionName: null, fingerprint: null });
    await expect(store.healthCheck()).resolves.toBeUndefined();
    expect(ports.getOrCreateCollection).not.toHaveBeenCalled();
  });

  it('creates a cosine collection with the complete embedding fingerprint', async () => {
    const ports = chromaPorts();
    const store = new ChromaVectorStore(config(), embeddingFactory(), ports.client);

    await expect(store.healthCheck()).resolves.toBeUndefined();
    const createInput = ports.getOrCreateCollection.mock.calls[0]?.[0];
    expect(createInput?.name).toContain('nexuskbtest_alibaba_text-embedding-v4_3_v1_');
    expect(createInput?.configuration).toEqual({ hnsw: { space: 'cosine' } });
    expect(createInput?.embeddingFunction).toBeNull();
    expect(createInput?.metadata).toMatchObject({
      fingerprint: 'a'.repeat(64),
      dimensions: 3,
      taskMode: 'symmetric',
      redactionPolicyVersion: 'v1',
    });
  });

  it('rejects a collection whose metadata fingerprint is incompatible', async () => {
    const ports = chromaPorts({ metadataMismatch: true });
    const store = new ChromaVectorStore(config(), embeddingFactory(), ports.client);

    await expect(store.healthCheck()).rejects.toMatchObject({
      kind: 'configuration_mismatch',
    });
  });

  it('upserts stable IDs in batches, applies tenant ACL filters and deletes by tenant/document', async () => {
    const ports = chromaPorts();
    const store = new ChromaVectorStore(config(), embeddingFactory(), ports.client);
    const chunks = [chunk('a'.repeat(64)), chunk('b'.repeat(64)), chunk('c'.repeat(64))];

    await store.upsert(chunks, [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    expect(ports.upsert).toHaveBeenCalledTimes(2);
    const firstUpsert = ports.upsert.mock.calls[0]?.[0];
    expect(firstUpsert?.documents).toEqual(['脱敏后的正文', '脱敏后的正文']);
    expect(JSON.stringify(firstUpsert)).not.toContain('originalText');

    await expect(
      store.query({
        vector: [1, 0, 0],
        topK: 5,
        filter: {
          tenantId: 'tenant-a',
          departments: ['finance'],
          allowedSensitivities: ['public', 'internal'],
          userId: 'user-a',
        },
      }),
    ).resolves.toMatchObject([{ id: 'chunk-a', distance: 0.1 }]);
    expect(ports.query.mock.calls[0]?.[0].where).toMatchObject({
      $and: [{ tenantId: 'tenant-a' }, expect.any(Object)],
    });

    await store.deleteDocument('tenant-a', '6769af9a-a4d0-4dc2-a97d-942584a9c826');
    expect(ports.deleteRecords).toHaveBeenCalledWith({
      where: {
        $and: [{ tenantId: 'tenant-a' }, { documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826' }],
      },
    });
  });
});
