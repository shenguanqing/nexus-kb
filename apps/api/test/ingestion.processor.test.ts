import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../src/config/app-config';
import type { PrismaService } from '../src/database/prisma.service';
import { ChunkingService } from '../src/ingestion/chunking';
import { CloudPolicyService } from '../src/ingestion/cloud-policy';
import { IngestionProcessor } from '../src/ingestion/ingestion.processor';
import { RedactionService } from '../src/ingestion/redaction';
import type { ParserClient } from '../src/parser/parser-client';
import type { EmbeddingProviderFactory } from '../src/providers/embedding/embedding-provider.factory';
import type { EmbeddingService } from '../src/providers/embedding/embedding.service';
import type { ChromaVectorStore } from '../src/vector-store/chroma-vector-store';
import type { VectorChunk } from '../src/vector-store/vector-store';
import { VectorStoreError } from '../src/vector-store/vector-store-error';

type EmbedDocumentsCall = (
  texts: string[],
  context: { sensitivity: 'public' | 'internal' | 'confidential' },
) => Promise<number[][]>;
type VectorUpsertCall = (chunks: VectorChunk[], vectors: number[][]) => Promise<void>;

function config(): AppConfig {
  return {
    values: {
      RAW_DOCS_PATH: '/data/raw-docs',
      CHUNK_MAX_TOKENS: 600,
      CHUNK_OVERLAP_TOKENS: 80,
      REDACTION_POLICY_VERSION: 'v1',
      BUSINESS_REDACTION_RULES_JSON: [],
      ALLOW_CONFIDENTIAL_TO_CLOUD: false,
      CLOUD_EGRESS_RULES_JSON: [],
    },
  } as unknown as AppConfig;
}

function dependencies(sensitivity: 'internal' | 'confidential' = 'internal') {
  const documentId = randomUUID();
  const jobId = randomUUID();
  const record = {
    id: jobId,
    tenantId: 'tenant-a',
    documentId,
    version: 1,
    status: 'queued',
    step: 'queued',
    attempts: 0,
    traceId: randomUUID(),
    parserVersion: null,
    embeddingFingerprint: null,
    vectorCollection: null,
    warnings: null,
    errorCode: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    document: {
      id: documentId,
      tenantId: 'tenant-a',
      sourceName: 'fixture.md',
      storageKey: `${documentId}.md`,
      mimeType: 'text/markdown',
      contentSha256: '0'.repeat(64),
      department: 'finance',
      sensitivity,
      ownerId: 'user-a',
      activeVersion: null,
      status: 'uploaded',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    },
  };
  const updateJob = vi.fn().mockResolvedValue({ count: 1 });
  const updateDocument = vi.fn().mockResolvedValue({ count: 1 });
  const updateVersion = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    ingestionJob: {
      findUnique: vi.fn().mockResolvedValue(record),
      updateMany: updateJob,
    },
    document: { updateMany: updateDocument },
    documentVersion: { updateMany: updateVersion },
    knowledgeChunk: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    cloudPolicyEvent: { create: vi.fn().mockResolvedValue({ id: randomUUID() }) },
    $transaction: vi.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
  } as unknown as PrismaService;
  const parser = {
    parse: vi.fn().mockResolvedValue({
      parser: 'markdown',
      parserVersion: '1.1.0',
      warnings: [],
      elements: [
        {
          text: '联系邮箱 demo@example.com',
          elementType: 'paragraph',
          page: 1,
          sheet: null,
          sectionPath: ['测试'],
          bbox: null,
          metadata: {},
        },
      ],
    }),
  } as unknown as ParserClient;
  const embedDocuments = vi.fn<EmbedDocumentsCall>().mockResolvedValue([[1, 0, 0]]);
  const embedding = { embedDocuments } as unknown as EmbeddingService;
  const upsert = vi.fn<VectorUpsertCall>().mockResolvedValue(undefined);
  const vectorStore = {
    info: () => ({
      enabled: true,
      collectionName: 'nexuskb_alibaba_test',
      fingerprint: 'a'.repeat(64),
    }),
    upsert,
  } as unknown as ChromaVectorStore;
  const embeddingFactory = {
    getProvider: () => ({
      id: 'alibaba',
      region: 'cn-beijing',
    }),
  } as EmbeddingProviderFactory;
  const appConfig = config();
  const processor = new IngestionProcessor(
    appConfig,
    prisma,
    parser,
    new ChunkingService(appConfig),
    new RedactionService(appConfig),
    new CloudPolicyService(appConfig),
    embeddingFactory,
    embedding,
    vectorStore,
  );
  return {
    processor,
    payload: { ingestionJobId: jobId, documentId, storageKey: `${documentId}.md` },
    embedding,
    vectorStore,
    embedDocuments,
    upsert,
    updateDocument,
    updateJob,
    updateVersion,
  };
}

describe('IngestionProcessor vector indexing', () => {
  it('activates a version only after embedding and stable vector upsert succeed', async () => {
    const deps = dependencies();

    await deps.processor.process(deps.payload);

    expect(deps.embedDocuments).toHaveBeenCalledWith(['联系邮箱 [REDACTED:EMAIL]'], {
      sensitivity: 'internal',
    });
    expect(deps.upsert).toHaveBeenCalledOnce();
    const [chunks] = deps.upsert.mock.calls[0] ?? [];
    expect(chunks?.[0]?.redactedText).toBe('联系邮箱 [REDACTED:EMAIL]');
    expect(JSON.stringify(chunks)).not.toContain('demo@example.com');
    type UpdateInput = { data: Record<string, unknown> };
    const jobUpdates = deps.updateJob.mock.calls as unknown as Array<[UpdateInput]>;
    const versionUpdates = deps.updateVersion.mock.calls as unknown as Array<[UpdateInput]>;
    const documentUpdates = deps.updateDocument.mock.calls as unknown as Array<[UpdateInput]>;
    expect(jobUpdates.some(([input]) => input.data.status === 'indexing')).toBe(true);
    const indexedVersion = versionUpdates.find(
      ([input]) => input.data.embeddingFingerprint === 'a'.repeat(64),
    )?.[0];
    expect(indexedVersion?.data.vectorCollection).toBe('nexuskb_alibaba_test');
    expect(indexedVersion?.data.indexedAt).toBeInstanceOf(Date);
    expect(
      documentUpdates.some(
        ([input]) => input.data.status === 'active' && input.data.activeVersion === 1,
      ),
    ).toBe(true);
  });

  it('does not activate the document when vector upsert fails', async () => {
    const deps = dependencies();
    deps.upsert.mockRejectedValueOnce(new VectorStoreError('unavailable'));

    await expect(deps.processor.process(deps.payload)).rejects.toMatchObject({
      code: 'VECTOR_STORE_UNAVAILABLE',
    });
    type UpdateInput = { data: Record<string, unknown> };
    const documentUpdates = deps.updateDocument.mock.calls as unknown as Array<[UpdateInput]>;
    const jobUpdates = deps.updateJob.mock.calls as unknown as Array<[UpdateInput]>;
    expect(
      documentUpdates.some(
        ([input]) => input.data.status === 'active' && input.data.activeVersion === 1,
      ),
    ).toBe(false);
    expect(documentUpdates.at(-1)?.[0].data.status).toBe('failed');
    expect(jobUpdates.at(-1)?.[0].data).toMatchObject({
      status: 'failed',
      step: 'failed',
      errorCode: 'VECTOR_STORE_UNAVAILABLE',
    });
  });

  it('keeps confidential documents out of embedding and Chroma', async () => {
    const deps = dependencies('confidential');

    await deps.processor.process(deps.payload);

    expect(deps.embedDocuments).not.toHaveBeenCalled();
    expect(deps.upsert).not.toHaveBeenCalled();
    type UpdateInput = { data: Record<string, unknown> };
    const documentUpdates = deps.updateDocument.mock.calls as unknown as Array<[UpdateInput]>;
    expect(documentUpdates.at(-1)?.[0].data).toMatchObject({
      status: 'policy_blocked',
      activeVersion: null,
    });
  });
});
