import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import type {
  EmbeddingBatchProgress,
  EmbeddingService,
} from '../src/providers/embedding/embedding.service';
import type { ChromaVectorStore } from '../src/vector-store/chroma-vector-store';
import type { VectorChunk } from '../src/vector-store/vector-store';
import { VectorStoreError } from '../src/vector-store/vector-store-error';

type EmbedDocumentsCall = (
  texts: string[],
  context: {
    sensitivity: 'public' | 'internal' | 'confidential';
    tenantId?: string;
    onBatchCompleted?: (progress: EmbeddingBatchProgress) => Promise<void>;
  },
) => Promise<number[][]>;
type VectorUpsertCall = (chunks: VectorChunk[], vectors: number[][]) => Promise<void>;

function config(): AppConfig {
  return {
    values: {
      RAW_DOCS_PATH: '/data/raw-docs',
      PREVIEW_ARTIFACTS_PATH: '/data/previews',
      CHUNK_MAX_TOKENS: 600,
      CHUNK_OVERLAP_TOKENS: 80,
      REDACTION_POLICY_VERSION: 'v1',
      BUSINESS_REDACTION_RULES_JSON: [],
      EMBEDDING_BATCH_SIZE: 32,
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
    embeddingCompletedChunks: 0,
    embeddingTotalChunks: null,
    embeddingBatchSize: null,
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
      embeddingCacheKey: null,
      createdAt: new Date(),
    },
  ]);
  const upsertPolicyEvent = vi.fn().mockResolvedValue({ id: randomUUID() });
  const findDocument = vi
    .fn()
    .mockImplementation((input: { where?: { status?: { in?: string[] } } }) =>
      input.where?.status?.in ? null : { id: documentId },
    );
  const transactionClient = {
    ingestionJob: {
      findUnique: vi.fn().mockResolvedValue(record),
      updateMany: updateJob,
    },
    document: {
      updateMany: updateDocument,
      findFirst: findDocument,
    },
    documentVersion: { updateMany: updateVersion },
    knowledgeChunk: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: findPreparedChunks,
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
      model: 'text-embedding-v4',
      dimensions: 3,
      region: 'cn-beijing',
      taskMode: 'symmetric',
      documentTaskRule: 'SYMMETRIC',
      queryTaskRule: 'SYMMETRIC',
    }),
    getFingerprint: () => ({
      value: 'a'.repeat(64),
      configuration: {
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
    appConfig,
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
    findDocument,
    findPreparedChunks,
    upsertPolicyEvent,
  };
}

describe('IngestionProcessor vector indexing', () => {
  it('removes parser preview artifacts when deletion wins an in-flight parse race', async () => {
    const deps = dependencies();
    const directory = await mkdtemp(join(tmpdir(), 'nexuskb-ingestion-delete-race-'));
    const previewRoot = join(directory, 'previews');
    const cadRoot = join(previewRoot, `${deps.record.documentId}.cad`);
    await mkdir(cadRoot, { recursive: true });
    await writeFile(join(cadRoot, 'overview.png'), 'preview');
    deps.appConfig.values.PREVIEW_ARTIFACTS_PATH = previewRoot;
    deps.findDocument.mockResolvedValueOnce({ id: deps.record.documentId });
    deps.parse.mockRejectedValueOnce(new Error('parser timeout'));

    try {
      await expect(deps.processor.process(deps.payload)).resolves.toBeUndefined();
      await expect(readdir(previewRoot)).resolves.toEqual([]);
      type UpdateInput = { data: Record<string, unknown> };
      const jobUpdates = deps.updateJob.mock.calls as unknown as Array<[UpdateInput]>;
      expect(jobUpdates.some(([input]) => input.data.status === 'failed')).toBe(false);
      expect(deps.updateVersion).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

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

    expect(deps.embedDocuments).toHaveBeenCalledWith(
      ['联系邮箱 [REDACTED:EMAIL]'],
      expect.objectContaining({ sensitivity: 'internal', tenantId: 'tenant-a' }),
    );
    expect(deps.upsert).toHaveBeenCalledOnce();
    type PolicyEventUpsertInput = {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    const policyEventCalls = deps.upsertPolicyEvent.mock.calls as unknown as Array<
      [PolicyEventUpsertInput]
    >;
    expect(policyEventCalls[0]?.[0].create).toMatchObject({
      providerId: 'alibaba',
      embeddingModel: 'text-embedding-v4',
    });
    expect(policyEventCalls[0]?.[0].update).toMatchObject({
      providerId: 'alibaba',
      embeddingModel: 'text-embedding-v4',
    });
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

  it('binds a parser-generated preview artifact to the ACL-protected document', async () => {
    const deps = dependencies();
    deps.parse.mockResolvedValueOnce({
      parser: 'python-docx',
      parserVersion: '1.1.0',
      warnings: [],
      elements: [
        {
          text: '预览内容',
          elementType: 'paragraph',
          page: 1,
          sheet: null,
          sectionPath: [],
          bbox: null,
          metadata: {},
        },
      ],
      preview: {
        storageKey: `${deps.record.documentId}.pdf`,
        kind: 'pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        renderer: 'libreoffice',
        rendererVersion: '25.2.4',
      },
    });

    await deps.processor.process(deps.payload);

    type UpdateInput = { data: Record<string, unknown> };
    const documentUpdates = deps.updateDocument.mock.calls as unknown as Array<[UpdateInput]>;
    expect(documentUpdates.some(([input]) => Object.hasOwn(input.data, 'previewStorageKey'))).toBe(
      true,
    );
    expect(
      documentUpdates.find(([input]) => Object.hasOwn(input.data, 'previewStorageKey'))?.[0].data,
    ).toMatchObject({
      previewStorageKey: `${deps.record.documentId}.pdf`,
      previewKind: 'pdf',
      previewMimeType: 'application/pdf',
      previewRenderer: 'libreoffice',
    });
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
    expect(deps.embedDocuments).toHaveBeenCalledWith(
      ['联系邮箱 [REDACTED:EMAIL]'],
      expect.objectContaining({ sensitivity: 'internal', tenantId: 'tenant-a' }),
    );
    expect(deps.upsert).toHaveBeenCalledOnce();
  });

  it('resumes an embedding-batch checkpoint without parsing and persists the next batch', async () => {
    const deps = dependencies();
    deps.record.status = 'failed';
    deps.record.step = 'failed';
    deps.record.checkpoint = 'embedding_batch:1/2';
    deps.embedDocuments.mockImplementationOnce(async (_texts, context) => {
      await context.onBatchCompleted?.({
        completedChunks: 1,
        totalChunks: 1,
        completedBatches: 1,
        totalBatches: 1,
        batchSize: 32,
        cacheKeys: ['c'.repeat(64)],
      });
      return [[1, 0, 0]];
    });

    await deps.processor.process(deps.payload);

    expect(deps.parse).not.toHaveBeenCalled();
    type UpdateInput = { data: Record<string, unknown> };
    const jobUpdates = deps.updateJob.mock.calls as unknown as Array<[UpdateInput]>;
    expect(
      jobUpdates.some(
        ([input]) =>
          input.data.checkpoint === 'embedding_batch:1/1' &&
          input.data.embeddingCompletedChunks === 1,
      ),
    ).toBe(true);
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
