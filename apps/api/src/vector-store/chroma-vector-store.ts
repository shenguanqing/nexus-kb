import { Inject, Injectable, Optional } from '@nestjs/common';
import { ChromaClient } from 'chromadb';
import type { Collection, Metadata, Where } from 'chromadb';

import { AppConfig } from '../config/app-config';
import { EmbeddingProviderFactory } from '../providers/embedding/embedding-provider.factory';
import type {
  RetrievedVectorChunk,
  VectorAclFilter,
  VectorChunk,
  VectorQueryInput,
  VectorStore,
  VectorStoreInfo,
} from './vector-store';
import { VectorStoreError } from './vector-store-error';

type ChromaCollection = Pick<
  Collection,
  'configuration' | 'delete' | 'get' | 'metadata' | 'query' | 'upsert'
>;

type ChromaClientPort = Pick<ChromaClient, 'getOrCreateCollection' | 'heartbeat' | 'version'>;

export const CHROMA_CLIENT = Symbol('CHROMA_CLIENT');

@Injectable()
export class ChromaVectorStore implements VectorStore {
  private readonly client: ChromaClientPort;
  private collection?: ChromaCollection;

  constructor(
    private readonly config: AppConfig,
    private readonly embeddingFactory: EmbeddingProviderFactory,
    @Optional()
    @Inject(CHROMA_CLIENT)
    client?: ChromaClientPort,
  ) {
    this.client = client ?? this.createClient();
  }

  info(): VectorStoreInfo {
    if (!this.isEnabled()) return { enabled: false, collectionName: null, fingerprint: null };
    const fingerprint = this.embeddingFactory.getFingerprint();
    return {
      enabled: true,
      collectionName: this.collectionName(fingerprint.value),
      fingerprint: fingerprint.value,
    };
  }

  async healthCheck(): Promise<void> {
    try {
      await this.client.heartbeat();
      await this.client.version();
      if (this.isEnabled()) await this.ensureCollection();
    } catch (error) {
      if (error instanceof VectorStoreError) throw error;
      throw new VectorStoreError('unavailable', { cause: error });
    }
  }

  async upsert(chunks: VectorChunk[], vectors: number[][]): Promise<void> {
    if (!this.isEnabled()) throw new VectorStoreError('not_configured');
    if (chunks.length === 0 || chunks.length !== vectors.length) {
      throw new VectorStoreError('invalid_input');
    }
    const dimensions = this.config.values.EMBEDDING_DIMENSIONS;
    if (
      vectors.some(
        (vector) => vector.length !== dimensions || vector.some((value) => !Number.isFinite(value)),
      )
    ) {
      throw new VectorStoreError('invalid_input');
    }
    const collection = await this.ensureCollection();
    const batchSize = this.config.values.CHROMA_UPSERT_BATCH_SIZE;
    try {
      for (let offset = 0; offset < chunks.length; offset += batchSize) {
        const chunkBatch = chunks.slice(offset, offset + batchSize);
        await collection.upsert({
          ids: chunkBatch.map((chunk) => chunk.id),
          embeddings: vectors.slice(offset, offset + batchSize),
          documents: chunkBatch.map((chunk) => chunk.redactedText),
          metadatas: chunkBatch.map((chunk) => this.chunkMetadata(chunk)),
        });
      }
      const stored = await collection.get({ ids: chunks.map((chunk) => chunk.id), include: [] });
      if (
        stored.ids.length !== chunks.length ||
        chunks.some((chunk) => !stored.ids.includes(chunk.id))
      ) {
        throw new VectorStoreError('invalid_response');
      }
    } catch (error) {
      if (error instanceof VectorStoreError) throw error;
      throw new VectorStoreError('unavailable', { cause: error });
    }
  }

  async query(input: VectorQueryInput): Promise<RetrievedVectorChunk[]> {
    if (!this.isEnabled()) throw new VectorStoreError('not_configured');
    if (
      input.vector.length !== this.config.values.EMBEDDING_DIMENSIONS ||
      input.vector.some((value) => !Number.isFinite(value)) ||
      input.topK < 1 ||
      input.topK > this.config.values.CHROMA_QUERY_MAX_TOP_K
    ) {
      throw new VectorStoreError('invalid_input');
    }
    const collection = await this.ensureCollection();
    try {
      const result = await collection.query({
        queryEmbeddings: [input.vector],
        nResults: input.topK,
        where: this.aclWhere(input.filter),
        include: ['documents', 'metadatas', 'distances'],
      });
      const ids = result.ids[0] ?? [];
      const documents = result.documents[0] ?? [];
      const metadatas = result.metadatas[0] ?? [];
      const distances = result.distances[0] ?? [];
      if (
        documents.length !== ids.length ||
        metadatas.length !== ids.length ||
        distances.length !== ids.length
      ) {
        throw new VectorStoreError('invalid_response');
      }
      return ids.map((id, index) => {
        const text = documents[index];
        const metadata = metadatas[index];
        const distance = distances[index];
        if (typeof text !== 'string' || !metadata || typeof distance !== 'number') {
          throw new VectorStoreError('invalid_response');
        }
        return {
          id,
          text,
          distance,
          metadata: this.scalarMetadata(metadata),
        };
      });
    } catch (error) {
      if (error instanceof VectorStoreError) throw error;
      throw new VectorStoreError('unavailable', { cause: error });
    }
  }

  async deleteDocument(tenantId: string, documentId: string): Promise<void> {
    if (!this.isEnabled()) return;
    const collection = await this.ensureCollection();
    try {
      await collection.delete({
        where: { $and: [{ tenantId }, { documentId }] },
      });
    } catch (error) {
      throw new VectorStoreError('unavailable', { cause: error });
    }
  }

  private createClient(): ChromaClient {
    const url = new URL(this.config.values.CHROMA_URL);
    return new ChromaClient({
      host: url.hostname,
      port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
      ssl: url.protocol === 'https:',
      tenant: this.config.values.CHROMA_TENANT,
      database: this.config.values.CHROMA_DATABASE,
    });
  }

  private async ensureCollection(): Promise<ChromaCollection> {
    if (this.collection) return this.collection;
    const fingerprint = this.embeddingFactory.getFingerprint();
    const expectedMetadata = {
      fingerprint: fingerprint.value,
      schemaVersion: this.config.values.CHROMA_SCHEMA_VERSION,
      provider: fingerprint.configuration.provider,
      model: fingerprint.configuration.model,
      dimensions: fingerprint.configuration.dimensions,
      taskMode: fingerprint.configuration.taskMode,
      chunkMaxTokens: fingerprint.configuration.chunkMaxTokens,
      chunkOverlapTokens: fingerprint.configuration.chunkOverlapTokens,
      redactionPolicyVersion: fingerprint.configuration.redactionPolicyVersion,
    };
    try {
      const collection = await this.client.getOrCreateCollection({
        name: this.collectionName(fingerprint.value),
        metadata: expectedMetadata,
        configuration: { hnsw: { space: 'cosine' } },
        embeddingFunction: null,
      });
      this.validateCollection(collection, expectedMetadata);
      this.collection = collection;
      return collection;
    } catch (error) {
      if (error instanceof VectorStoreError) throw error;
      throw new VectorStoreError('unavailable', { cause: error });
    }
  }

  private validateCollection(
    collection: ChromaCollection,
    expectedMetadata: Record<string, boolean | number | string>,
  ): void {
    const actualMetadata = collection.metadata ?? {};
    const metadataMatches = Object.entries(expectedMetadata).every(
      ([key, value]) => actualMetadata[key] === value,
    );
    if (!metadataMatches || collection.configuration.hnsw?.space !== 'cosine') {
      throw new VectorStoreError('configuration_mismatch');
    }
  }

  private collectionName(fingerprint: string): string {
    const modelSlug = this.config.values.EMBEDDING_MODEL.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return [
      this.config.values.CHROMA_COLLECTION_PREFIX,
      this.config.values.EMBEDDING_PROVIDER,
      modelSlug,
      this.config.values.EMBEDDING_DIMENSIONS,
      `v${this.config.values.CHROMA_SCHEMA_VERSION}`,
      fingerprint.slice(0, 12),
    ].join('_');
  }

  private chunkMetadata(chunk: VectorChunk): Metadata {
    return {
      tenantId: chunk.tenantId,
      documentId: chunk.documentId,
      documentVersion: chunk.documentVersion,
      chunkId: chunk.id,
      ordinal: chunk.ordinal,
      sourceName: chunk.sourceName,
      department: chunk.department,
      sensitivity: chunk.sensitivity,
      ownerId: chunk.ownerId,
      sectionPath: JSON.stringify(chunk.sectionPath),
      ...(chunk.page === null ? {} : { page: chunk.page }),
      ...(chunk.sheet === null ? {} : { sheet: chunk.sheet }),
      ...(chunk.previousChunkId === null ? {} : { previousChunkId: chunk.previousChunkId }),
      ...(chunk.nextChunkId === null ? {} : { nextChunkId: chunk.nextChunkId }),
    };
  }

  private aclWhere(filter: VectorAclFilter): Where {
    if (!filter.tenantId || !filter.userId || filter.allowedSensitivities.length === 0) {
      throw new VectorStoreError('invalid_input');
    }
    const branches: Where[] = [];
    if (filter.allowedSensitivities.includes('public')) {
      branches.push({ sensitivity: 'public' });
    }
    const restrictedSensitivities = filter.allowedSensitivities.filter(
      (sensitivity) => sensitivity !== 'public',
    );
    if (restrictedSensitivities.length > 0 && filter.departments.length > 0) {
      branches.push({
        $and: [
          { department: { $in: filter.departments } },
          { sensitivity: { $in: restrictedSensitivities } },
        ],
      });
    }
    if (restrictedSensitivities.length > 0) {
      branches.push({
        $and: [{ ownerId: filter.userId }, { sensitivity: { $in: restrictedSensitivities } }],
      });
    }
    if (branches.length === 0) throw new VectorStoreError('invalid_input');
    const firstBranch = branches[0];
    if (!firstBranch) throw new VectorStoreError('invalid_input');
    const accessWhere = branches.length === 1 ? firstBranch : { $or: branches };
    return {
      $and: [{ tenantId: filter.tenantId }, accessWhere],
    };
  }

  private scalarMetadata(metadata: Metadata): Record<string, boolean | number | string> {
    const result: Record<string, boolean | number | string> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        result[key] = value;
      }
    }
    return result;
  }

  private isEnabled(): boolean {
    return this.config.values.EMBEDDING_PROVIDER !== 'none';
  }
}
