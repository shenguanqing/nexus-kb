import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../src/config/app-config';
import type { OperationalLogger } from '../src/common/operational-logger';
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
    kind: 'ingestion',
    activateOnComplete: true,
    status: 'queued',
    step: 'queued',
    checkpoint: 'queued',
    attempts: 0,
    traceId: randomUUID(),
    parserVersion: null,
    embeddingFingerprint: null,
    vectorCollection: null,
    warnings: null,
    errorCode: null,
    errorCategory: null,
    retryable: false,
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
  const findPreparedChunks = vi.fn().mockResolvedValue([
    {
      id: 'a'.repeat(64),
      tenantId: 'tenant-a',
      documentId,
      documentVersion: 1,
      ordinal: 0,
      originalText: '联系邮箱 demo@example.com',
      redactedText: '联系邮箱 [REDACTED:EMAIL]',
      tokenCount: 4,
      page: 1,
      sheet: null,
      sectionPath: ['测试'],
      elementTypes: ['paragraph'],
      previousChunkId: null,
      nextChunkId: null,
      redactionPolicyVersion: 'v1',
      redactionSummary: { EMAIL: 1 },
      createdAt: new Date(),
    },
  ]);
  const upsertPolicyEvent = vi.fn().mockResolvedValue({ id: randomUUID() });
  const transactionClient = {
    ingestionJob: {
      findUnique: vi.fn().mockResolvedValue(record),
      updateMany: updateJob,
    },
    document: {
      updateMany: updateDocument,
      findFirst: vi.fn().mockResolvedValue({ id: documentId }),
    },
    documentVersion: { updateMany: updateVersion },
    knowledgeChunk: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: findPreparedChunks,
    },
    cloudPolicyEvent: { upsert: upsertPolicyEvent },
    documentLifecycleAudit: { create: vi.fn().mockResolvedValue({ id: randomUUID() }) },
  };
  const prisma = {
    ...transactionClient,
    $transaction: vi.fn(
      (
        input: Array<Promise<unknown>> | ((client: typeof transactionClient) => Promise<unknown>),
      ) => (typeof input === 'function' ? input(transactionClient) : Promise.all(input)),
    ),
  } as unknown as PrismaService;
  const parse = vi.fn().mockResolvedValue({
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
  });
  const parser = { parse } as unknown as ParserClient;
  const embedDocuments = vi.fn<EmbedDocumentsCall>().mockResolvedValue([[1, 0, 0]]);
  const embedding = { embedDocuments } as unknown as EmbeddingService;
  const upsert = vi.fn<VectorUpsertCall>().mockResolvedValue(undefined);
  const deleteVectorDocument = vi.fn().mockResolvedValue(undefined);
  const deleteVectorDocumentVersion = vi.fn().mockResolvedValue(undefined);
  const vectorStore = {
    info: () => ({
      enabled: true,
      collectionName: 'nexuskb_alibaba_test',
      fingerprint: 'a'.repeat(64),
    }),
    upsert,
    deleteDocument: deleteVectorDocument,
    deleteDocumentVersion: deleteVectorDocumentVersion,
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
    {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as OperationalLogger,
  );
  return {
    processor,
    payload: { ingestionJobId: jobId, documentId, storageKey: `${documentId}.md` },
    embedding,
    vectorStore,
    embedDocuments,
    upsert,
    deleteVectorDocument,
    deleteVectorDocumentVersion,
    updateDocument,
    updateJob,
    updateVersion,
    record,
    parse,
    findPreparedChunks,
    upsertPolicyEvent,
  };
}

describe('IngestionProcessor vector indexing', () => {
  it('reports the converting stage before parsing DWG input', async () => {
    const deps = dependencies();
    deps.record.document.sourceName = 'drawing.dwg';
    deps.record.document.storageKey = `${deps.record.documentId}.dwg`;
    deps.record.document.mimeType = 'image/vnd.dwg';
    deps.payload.storageKey = `${deps.record.documentId}.dwg`;

    await deps.processor.process(deps.payload);

    type UpdateInput = { data: Record<string, unknown> };
    const jobUpdates = deps.updateJob.mock.calls as unknown as Array<[UpdateInput]>;
    expect(jobUpdates[0]?.[0].data).toMatchObject({
      status: 'converting',
      step: 'converting',
    });
    expect(deps.parse).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'image/vnd.dwg' }),
      deps.record.traceId,
    );
  });

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
      errorCategory: 'vector_store',
      retryable: true,
    });
  });

  it('keeps the previous active version queryable when reindexing fails', async () => {
    const deps = dependencies();
    deps.record.version = 2;
    deps.record.kind = 'reindex';
    deps.record.document.activeVersion = 1;
    deps.record.document.status = 'active';
    deps.upsert.mockRejectedValueOnce(new VectorStoreError('unavailable'));

    await expect(deps.processor.process(deps.payload)).rejects.toMatchObject({
      code: 'VECTOR_STORE_UNAVAILABLE',
    });

    type UpdateInput = { data: Record<string, unknown> };
    const documentUpdates = deps.updateDocument.mock.calls as unknown as Array<[UpdateInput]>;
    expect(documentUpdates.at(-1)?.[0].data).toEqual({ status: 'active' });
    expect(documentUpdates.some(([input]) => input.data.activeVersion === null)).toBe(false);
  });

  it('keeps a migration candidate inactive after its vectors are verified', async () => {
    const deps = dependencies();
    deps.record.version = 2;
    deps.record.kind = 'index_migration';
    deps.record.activateOnComplete = false;
    deps.record.document.activeVersion = 1;
    deps.record.document.status = 'active';

    await deps.processor.process(deps.payload);

    type UpdateInput = { data: Record<string, unknown> };
    const versionUpdates = deps.updateVersion.mock.calls as unknown as Array<[UpdateInput]>;
    const documentUpdates = deps.updateDocument.mock.calls as unknown as Array<[UpdateInput]>;
    expect(versionUpdates.some(([input]) => input.data.status === 'prepared')).toBe(true);
    expect(documentUpdates.some(([input]) => input.data.activeVersion === 2)).toBe(false);
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

  it('resumes from locally prepared chunks without parsing or recreating policy events', async () => {
    const deps = dependencies();
    deps.record.status = 'failed';
    deps.record.step = 'failed';
    deps.record.checkpoint = 'local_prepared';

    await deps.processor.process(deps.payload);

    expect(deps.parse).not.toHaveBeenCalled();
    expect(deps.findPreparedChunks).toHaveBeenCalledOnce();
    expect(deps.upsertPolicyEvent).not.toHaveBeenCalled();
    expect(deps.embedDocuments).toHaveBeenCalledWith(['联系邮箱 [REDACTED:EMAIL]'], {
      sensitivity: 'internal',
    });
    expect(deps.upsert).toHaveBeenCalledOnce();
  });

  it('skips duplicate delivery after a job reached a terminal state', async () => {
    const deps = dependencies();
    deps.record.status = 'completed';
    deps.record.step = 'completed';
    deps.record.checkpoint = 'completed';

    await deps.processor.process(deps.payload);

    expect(deps.parse).not.toHaveBeenCalled();
    expect(deps.embedDocuments).not.toHaveBeenCalled();
    expect(deps.upsert).not.toHaveBeenCalled();
    expect(deps.updateJob).not.toHaveBeenCalled();
    expect(deps.upsertPolicyEvent).not.toHaveBeenCalled();
  });

  it('does not persist or index chunks when deletion wins the document lock', async () => {
    const deps = dependencies();
    deps.updateDocument.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    await deps.processor.process(deps.payload);

    expect(deps.parse).toHaveBeenCalledOnce();
    expect(deps.embedDocuments).not.toHaveBeenCalled();
    expect(deps.upsert).not.toHaveBeenCalled();
    expect(deps.upsertPolicyEvent).not.toHaveBeenCalled();
  });

  it('removes vectors when deletion wins after upsert but before activation', async () => {
    const deps = dependencies();
    deps.updateDocument
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await deps.processor.process(deps.payload);

    expect(deps.upsert).toHaveBeenCalledOnce();
    expect(deps.deleteVectorDocumentVersion).toHaveBeenCalledWith(
      'tenant-a',
      deps.record.documentId,
      deps.record.version,
    );
  });
});
