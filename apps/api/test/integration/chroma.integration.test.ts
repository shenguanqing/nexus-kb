import { randomUUID } from 'node:crypto';
import { ChromaClient } from 'chromadb';
import { afterAll, describe, expect, it } from 'vitest';

import type { AppConfig, Environment } from '../../src/config/app-config';
import { createEmbeddingFingerprint } from '../../src/providers/embedding/embedding-fingerprint';
import type { EmbeddingProviderFactory } from '../../src/providers/embedding/embedding-provider.factory';
import { ChromaVectorStore } from '../../src/vector-store/chroma-vector-store';
import type { VectorChunk } from '../../src/vector-store/vector-store';

const chromaUrl = new URL(process.env.CHROMA_URL ?? 'http://chroma:8000');
const tenant = process.env.CHROMA_TENANT ?? 'default_tenant';
const database = process.env.CHROMA_DATABASE ?? 'default_database';
const client = new ChromaClient({
  host: chromaUrl.hostname,
  port: Number(chromaUrl.port || 8000),
  ssl: chromaUrl.protocol === 'https:',
  tenant,
  database,
});
const collectionNames: string[] = [];

function createStore(prefix: string): ChromaVectorStore {
  const values = {
    CHROMA_URL: chromaUrl.toString(),
    CHROMA_TENANT: tenant,
    CHROMA_DATABASE: database,
    CHROMA_COLLECTION_PREFIX: prefix,
    CHROMA_SCHEMA_VERSION: 1,
    CHROMA_UPSERT_BATCH_SIZE: 100,
    CHROMA_QUERY_MAX_TOP_K: 20,
    EMBEDDING_PROVIDER: 'alibaba',
    EMBEDDING_MODEL: 'text-embedding-v4',
    EMBEDDING_DIMENSIONS: 3,
    EMBEDDING_TASK_MODE: 'symmetric',
    CHUNK_MAX_TOKENS: 600,
    CHUNK_OVERLAP_TOKENS: 80,
    REDACTION_POLICY_VERSION: 'v1',
  } as Environment;
  const config = { values } as AppConfig;
  const embeddingFactory = {
    getFingerprint: () => createEmbeddingFingerprint(values),
  } as EmbeddingProviderFactory;
  const store = new ChromaVectorStore(config, embeddingFactory);
  const collectionName = store.info().collectionName;
  if (collectionName) collectionNames.push(collectionName);
  return store;
}

function chunk(id: string, tenantId: string, documentId: string): VectorChunk {
  return {
    id,
    tenantId,
    documentId,
    documentVersion: 1,
    ordinal: 0,
    redactedText: `脱敏文本-${tenantId}`,
    sourceName: 'fixture.md',
    page: 1,
    sheet: null,
    sectionPath: ['测试'],
    department: 'finance',
    sensitivity: 'internal',
    ownerId: `user-${tenantId}`,
    previousChunkId: null,
    nextChunkId: null,
  };
}

afterAll(async () => {
  for (const name of collectionNames) {
    await client.deleteCollection({ name }).catch(() => undefined);
  }
});

describe('Chroma VectorStore integration', () => {
  it('keeps stable upserts idempotent and enforces tenant ACL filters before query', async () => {
    const prefix = `nkb${randomUUID().substring(0, 8)}`;
    const store = createStore(prefix);
    const documentA = randomUUID();
    const documentB = randomUUID();
    const chunks = [
      chunk('a'.repeat(64), 'tenant-a', documentA),
      chunk('b'.repeat(64), 'tenant-b', documentB),
    ];
    const vectors = [
      [1, 0, 0],
      [0, 1, 0],
    ];

    await store.upsert(chunks, vectors);
    await store.upsert(chunks, vectors);
    const collectionName = store.info().collectionName;
    if (!collectionName) throw new Error('Expected an enabled collection');
    const collection = await client.getCollection({ name: collectionName });
    await expect(collection.count()).resolves.toBe(2);

    const results = await store.query({
      vector: [1, 0, 0],
      topK: 10,
      filter: {
        tenantId: 'tenant-a',
        departments: ['finance'],
        allowedSensitivities: ['internal'],
        userId: 'user-tenant-a',
        tenantWideAccess: false,
      },
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 'a'.repeat(64),
      text: '脱敏文本-tenant-a',
      metadata: { tenantId: 'tenant-a', documentId: documentA },
    });

    await store.deleteDocumentFromCollections('tenant-a', documentA, [collectionName]);
    await expect(collection.count()).resolves.toBe(1);
  });

  it('rejects an existing collection with an incompatible fingerprint', async () => {
    const prefix = `nkb${randomUUID().substring(0, 8)}`;
    const store = createStore(prefix);
    const collectionName = store.info().collectionName;
    if (!collectionName) throw new Error('Expected an enabled collection');
    await client.createCollection({
      name: collectionName,
      metadata: { fingerprint: 'wrong' },
      configuration: { hnsw: { space: 'cosine' } },
      embeddingFunction: null,
    });

    await expect(store.healthCheck()).rejects.toMatchObject({
      kind: 'configuration_mismatch',
    });
  });
});
