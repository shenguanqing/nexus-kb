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

const DOCUMENT_HINT_PATTERN =
  /(?:#|楼|图|室|园|文档|文件|\.(?:pdf|dwg|dxf|docx?|xlsx|md|txt)\b|[a-z][a-z0-9_-]{3,})/iu;
const GENERIC_DOCUMENT_HINT_TERMS = [
  '建设单位',
  '工程名称',
  '智能化',
  '信息化',
  '平面图',
  '系统图',
  '设计说明',
  '图纸',
  '文档',
  '文件',
  '是哪家',
  '是什么',
  '有哪些',
  '有什么',
  '有几个',
  '几个',
  '多少',
  '尺寸',
  '讲了什么',
];
const MIN_DOCUMENT_HINT_CHARACTERS = 4;
const MIN_CJK_DOCUMENT_HINT_CHARACTERS = 3;
const MAX_DOCUMENT_HINT_DOCUMENTS = 200;
const MAX_MATCHED_DOCUMENTS = 5;

export interface QueryRetrievalResult {
  contexts: RetrievedChunk[];
  matchedDocumentIds: string[];
}

@Injectable()
export class QueryRetrievalService {
  constructor(
    private readonly config: AppConfig,
    private readonly vectorStore: ChromaVectorStore,
    private readonly prisma: PrismaService,
    private readonly acl: AclPolicy,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async retrieve(
    identity: Identity,
    vector: number[],
    question?: string,
  ): Promise<RetrievedChunk[]> {
    return (await this.retrieveDetailed(identity, vector, question)).contexts;
  }

  async retrieveDetailed(
    identity: Identity,
    vector: number[],
    question?: string,
  ): Promise<QueryRetrievalResult> {
    const recallTopK = this.config.values.QUERY_RECALL_TOP_K;
    const outputTopK =
      this.config.values.RERANK_PROVIDER === 'none' ? this.config.values.RERANK_TOP_K : recallTopK;
    const filter = this.acl.vectorFilter(identity);
    const globalQuery = this.vectorStore.query({
      vector,
      filter,
      topK: recallTopK,
    });
    const [globalResults, documentIds] = await Promise.all([
      globalQuery,
      question ? this.matchedDocumentIds(identity, question) : Promise.resolve([]),
    ]);
    const scopedResults =
      documentIds.length > 0
        ? await this.vectorStore.query({
            vector,
            filter: { ...filter, documentIds },
            topK: recallTopK,
          })
        : [];
    const seenIds = new Set<string>();
    const selectedResults = documentIds.length > 0 ? scopedResults : globalResults;
    const raw = selectedResults.filter((chunk) => {
      if (seenIds.has(chunk.id)) return false;
      seenIds.add(chunk.id);
      return true;
    });
    const mapped = raw.map((chunk) => this.mapVectorChunk(chunk));
    const relevant = mapped.filter(
      (chunk) => chunk.distance <= this.config.values.QUERY_MAX_DISTANCE,
    );
    if (relevant.length === 0) {
      this.metrics?.observeRetrieval(0);
      return { contexts: [], matchedDocumentIds: documentIds };
    }
    const matchedDocumentIdSet = new Set(documentIds);
    const expanded = await this.expandNeighbors(identity, relevant, matchedDocumentIdSet);
    const contexts = this.selectContexts(expanded, matchedDocumentIdSet, outputTopK);
    this.metrics?.observeRetrieval(contexts.length);
    return { contexts, matchedDocumentIds: documentIds };
  }

  private async matchedDocumentIds(identity: Identity, question: string): Promise<string[]> {
    if (!DOCUMENT_HINT_PATTERN.test(question)) return [];
    const normalizedQuestion = normalizeDocumentHint(question);
    const minimumCharacters = /[\p{Script=Han}]{3}/u.test(normalizedQuestion)
      ? MIN_CJK_DOCUMENT_HINT_CHARACTERS
      : MIN_DOCUMENT_HINT_CHARACTERS;
    if ([...normalizedQuestion].length < minimumCharacters) return [];
    const documents = await this.prisma.document.findMany({
      where: { ...this.acl.documentWhere(identity), status: 'active' },
      select: { id: true, sourceName: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: MAX_DOCUMENT_HINT_DOCUMENTS,
    });
    const scored = documents
      .map((document) => ({
        id: document.id,
        score: longestCommonSubstringLength(
          normalizedQuestion,
          normalizeDocumentHint(document.sourceName),
        ),
      }))
      .filter((document) => document.score >= minimumCharacters);
    const bestScore = Math.max(0, ...scored.map((document) => document.score));
    return scored
      .filter((document) => document.score === bestScore)
      .slice(0, MAX_MATCHED_DOCUMENTS)
      .map((document) => document.id);
  }

  private selectContexts(
    contexts: RetrievedChunk[],
    matchedDocumentIds: Set<string>,
    topK: number,
  ): RetrievedChunk[] {
    const ordered = [...contexts].sort((left, right) => {
      const leftScoped = matchedDocumentIds.has(left.metadata.documentId);
      const rightScoped = matchedDocumentIds.has(right.metadata.documentId);
      if (leftScoped !== rightScoped) return leftScoped ? -1 : 1;
      return left.distance - right.distance;
    });
    const seenTexts = new Set<string>();
    return ordered
      .filter((context) => {
        const textKey = normalizeContextText(context.text);
        if (seenTexts.has(textKey)) return false;
        seenTexts.add(textKey);
        return true;
      })
      .slice(0, topK);
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
    matchedDocumentIds = new Set<string>(),
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
      .sort((left, right) => {
        const leftScoped = matchedDocumentIds.has(left.metadata.documentId);
        const rightScoped = matchedDocumentIds.has(right.metadata.documentId);
        if (leftScoped !== rightScoped) return leftScoped ? -1 : 1;
        return left.distance - right.distance;
      })
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

function normalizeDocumentHint(value: string): string {
  let normalized = value
    .toLowerCase()
    .replaceAll('消防控制室', '消控室')
    .replaceAll('消防室', '消控室');
  for (const term of GENERIC_DOCUMENT_HINT_TERMS) {
    normalized = normalized.replaceAll(term, '');
  }
  return normalized
    .replace(/\.(?:pdf|dwg|dxf|docx?|xlsx|md|txt)$/iu, '')
    .replace(/[^\p{L}\p{N}#_-]+/gu, '')
    .slice(0, 128);
}

function normalizeContextText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

function longestCommonSubstringLength(left: string, right: string): number {
  const leftCharacters = [...left];
  const rightCharacters = [...right];
  let previous = new Array<number>(rightCharacters.length + 1).fill(0);
  let longest = 0;
  for (const leftCharacter of leftCharacters) {
    const current = new Array<number>(rightCharacters.length + 1).fill(0);
    for (const [index, rightCharacter] of rightCharacters.entries()) {
      if (leftCharacter !== rightCharacter) continue;
      current[index + 1] = (previous[index] ?? 0) + 1;
      longest = Math.max(longest, current[index + 1] ?? 0);
    }
    previous = current;
  }
  return longest;
}
