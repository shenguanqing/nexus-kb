import { Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';

import { AclPolicy } from '../auth/acl-policy';
import type { Identity } from '../auth/identity';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import { MetricsService } from '../observability/metrics.service';
import { ChromaVectorStore } from '../vector-store/chroma-vector-store';
import { VectorStoreError } from '../vector-store/vector-store-error';
import type { RetrievedVectorChunk } from '../vector-store/vector-store';
import type { RetrievedChunk } from './retrieved-chunk';

const metadataSchema = z.object({
  tenantId: z.string().min(1),
  documentId: z.uuid(),
  documentVersion: z.number().int().positive(),
  chunkId: z.string().regex(/^[0-9a-f]{64}$/),
  ordinal: z.number().int().nonnegative(),
  sourceName: z.string().min(1),
  department: z.string().min(1),
  sensitivity: z.enum(['public', 'internal', 'confidential']),
  ownerId: z.string().min(1),
  page: z.number().int().positive().optional(),
  sheet: z.string().optional(),
  sectionPath: z.string().optional(),
});

@Injectable()
export class QueryRetrievalService {
  constructor(
    private readonly config: AppConfig,
    private readonly vectorStore: ChromaVectorStore,
    private readonly prisma: PrismaService,
    private readonly acl: AclPolicy,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async retrieve(identity: Identity, vector: number[]): Promise<RetrievedChunk[]> {
    const raw = await this.vectorStore.query({
      vector,
      filter: this.acl.vectorFilter(identity),
      topK: this.config.values.QUERY_RECALL_TOP_K,
    });
    const mapped = raw.map((chunk) => this.mapVectorChunk(chunk));
    const relevant = mapped.filter(
      (chunk) => chunk.distance <= this.config.values.QUERY_MAX_DISTANCE,
    );
    if (relevant.length === 0) {
      this.metrics?.observeRetrieval(0);
      return [];
    }
    const expanded = await this.expandNeighbors(identity, relevant);
    this.metrics?.observeRetrieval(expanded.length);
    return expanded;
  }

  private mapVectorChunk(chunk: RetrievedVectorChunk): RetrievedChunk {
    const metadata = metadataSchema.safeParse(chunk.metadata);
    if (!metadata.success || !Number.isFinite(chunk.distance) || chunk.distance < 0) {
      throw new VectorStoreError('invalid_response');
    }
    let sectionPath: string[] | undefined;
    if (metadata.data.sectionPath) {
      try {
        const parsed: unknown = JSON.parse(metadata.data.sectionPath);
        if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
          throw new Error('invalid section path');
        }
        sectionPath = parsed;
      } catch (error) {
        throw new VectorStoreError('invalid_response', { cause: error });
      }
    }
    const { sectionPath: _rawSectionPath, ...baseMetadata } = metadata.data;
    void _rawSectionPath;
    return {
      id: chunk.id,
      text: chunk.text,
      distance: chunk.distance,
      metadata: { ...baseMetadata, ...(sectionPath ? { sectionPath } : {}) },
    };
  }

  private async expandNeighbors(
    identity: Identity,
    hits: RetrievedChunk[],
  ): Promise<RetrievedChunk[]> {
    const window = this.config.values.QUERY_NEIGHBOR_WINDOW;
    const windows = hits.flatMap((hit) => {
      const ordinal = hit.metadata.ordinal;
      return ordinal === undefined
        ? []
        : [
            {
              documentId: hit.metadata.documentId,
              documentVersion: hit.metadata.documentVersion,
              ordinal: { gte: Math.max(0, ordinal - window), lte: ordinal + window },
            },
          ];
    });
    if (windows.length === 0) return hits;
    const rows = await this.prisma.knowledgeChunk.findMany({
      where: {
        tenantId: identity.tenantId,
        OR: windows,
        document: { is: { ...this.acl.documentWhere(identity), status: 'active' } },
      },
      select: {
        id: true,
        documentId: true,
        documentVersion: true,
        ordinal: true,
        redactedText: true,
        page: true,
        sheet: true,
        sectionPath: true,
        document: {
          select: {
            activeVersion: true,
            sourceName: true,
            tenantId: true,
            department: true,
            sensitivity: true,
            ownerId: true,
          },
        },
      },
      orderBy: [{ documentId: 'asc' }, { documentVersion: 'asc' }, { ordinal: 'asc' }],
    });
    const activeRows = rows.filter((row) => row.document.activeVersion === row.documentVersion);
    const groups: (typeof activeRows)[] = [];
    for (const row of activeRows) {
      const current = groups.at(-1);
      const previous = current?.at(-1);
      if (
        !current ||
        !previous ||
        previous.documentId !== row.documentId ||
        previous.documentVersion !== row.documentVersion ||
        previous.ordinal + 1 !== row.ordinal ||
        previous.page !== row.page ||
        previous.sheet !== row.sheet
      ) {
        groups.push([row]);
      } else {
        current.push(row);
      }
    }
    const boundedGroups = groups.flatMap((group) => {
      const partitions: (typeof group)[] = [];
      for (const row of group) {
        let partition = partitions.at(-1);
        const currentLength =
          partition?.reduce((sum, item) => sum + item.redactedText.length, 0) ?? 0;
        if (
          !partition ||
          (partition.length > 0 &&
            currentLength + row.redactedText.length >
              this.config.values.QUERY_MAX_MERGED_CONTEXT_CHARS)
        ) {
          partition = [];
          partitions.push(partition);
        }
        partition.push(row);
      }
      return partitions;
    });
    const merged = boundedGroups.map((group) => {
      const first = group[0]!;
      const relatedHits = hits.filter(
        (hit) =>
          hit.metadata.documentId === first.documentId &&
          hit.metadata.documentVersion === first.documentVersion &&
          hit.metadata.ordinal !== undefined &&
          group.some((row) => Math.abs(row.ordinal - hit.metadata.ordinal!) <= window),
      );
      const distance = Math.min(...relatedHits.map((hit) => hit.distance));
      return {
        id: first.id,
        text: group.map((row) => row.redactedText).join('\n\n'),
        distance,
        metadata: {
          tenantId: first.document.tenantId,
          documentId: first.documentId,
          documentVersion: first.documentVersion,
          chunkId: first.id,
          chunkIds: group.map((row) => row.id),
          ordinal: first.ordinal,
          sourceName: first.document.sourceName,
          department: first.document.department,
          sensitivity: first.document.sensitivity,
          ownerId: first.document.ownerId,
          ...(first.page === null ? {} : { page: first.page }),
          ...(first.sheet === null ? {} : { sheet: first.sheet }),
          sectionPath: this.stringArray(first.sectionPath),
        },
      };
    });
    let totalCharacters = 0;
    return merged
      .sort((left, right) => left.distance - right.distance)
      .filter((context) => {
        if (
          totalCharacters + context.text.length >
          this.config.values.QUERY_MAX_RERANK_INPUT_CHARS
        ) {
          return false;
        }
        totalCharacters += context.text.length;
        return true;
      });
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
  }
}
