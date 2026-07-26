import { Injectable } from '@nestjs/common';
import type {
  AuditEvent,
  AuditEventType,
  AuditQueryRequest,
  AuditQueryResponse,
} from '@nexus-kb/contracts';

import { AclPolicy } from '../auth/acl-policy';
import type { Identity } from '../auth/identity';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly acl: AclPolicy,
  ) {}

  async query(request: AuditQueryRequest, identity: Identity): Promise<AuditQueryResponse> {
    this.acl.assertCapability(identity, 'audit:read');
    const before = request.before ? new Date(request.before) : undefined;
    const take = request.limit + 1;
    const selectedTypes: AuditEventType[] = request.type
      ? [request.type]
      : ['query', 'document_lifecycle', 'cloud_policy', 'access_change'];
    const batches = await Promise.all([
      selectedTypes.includes('query')
        ? this.queryEvents(identity.tenantId, before, take)
        : Promise.resolve([]),
      selectedTypes.includes('document_lifecycle')
        ? this.lifecycleEvents(identity.tenantId, before, take)
        : Promise.resolve([]),
      selectedTypes.includes('cloud_policy')
        ? this.policyEvents(identity.tenantId, before, take)
        : Promise.resolve([]),
      selectedTypes.includes('access_change')
        ? this.accessEvents(identity.tenantId, before, take)
        : Promise.resolve([]),
    ]);
    const allEvents = batches
      .flat()
      .sort(
        (left, right) =>
          Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
          right.id.localeCompare(left.id),
      );
    const hasMore = allEvents.length > request.limit;
    const events = allEvents.slice(0, request.limit);
    const oldest = events.at(-1);
    return {
      events,
      nextBefore:
        hasMore && oldest ? new Date(Date.parse(oldest.createdAt) - 1).toISOString() : null,
    };
  }

  private async queryEvents(tenantId: string, before: Date | undefined, take: number) {
    const rows = await this.prisma.queryAudit.findMany({
      where: { tenantId, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    });
    return rows.map((row): AuditEvent => ({
      id: row.id,
      type: 'query',
      event: 'knowledge_query',
      outcome: row.outcome,
      traceId: row.traceId,
      actorUserId: row.userId,
      documentId: null,
      ingestionJobId: null,
      attributes: {
        queryLength: row.queryLength,
        answerMode: row.answerMode,
        resultCount: row.resultCount,
        sourceChunkIds: this.stringArray(row.sourceChunkIds),
        embeddingProvider: row.embeddingProvider,
        embeddingModel: row.embeddingModel,
        rerankProvider: row.rerankProvider,
        rerankModel: row.rerankModel,
        rerankDegraded: row.rerankDegraded,
        llmProvider: row.llmProvider,
        llmModel: row.llmModel,
        fallbackUsed: row.fallbackUsed,
        errorCode: row.errorCode,
        durationMs: row.durationMs,
      },
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private async lifecycleEvents(tenantId: string, before: Date | undefined, take: number) {
    const rows = await this.prisma.documentLifecycleAudit.findMany({
      where: { tenantId, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    });
    return rows.map((row): AuditEvent => ({
      id: row.id,
      type: 'document_lifecycle',
      event: row.eventType,
      outcome: row.outcome,
      traceId: row.traceId,
      actorUserId: row.userId,
      documentId: row.documentId,
      ingestionJobId: row.ingestionJobId,
      attributes: {
        documentVersion: row.documentVersion,
        vectorCollection: row.vectorCollection,
        embeddingFingerprint: row.embeddingFingerprint,
      },
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private async policyEvents(tenantId: string, before: Date | undefined, take: number) {
    const rows = await this.prisma.cloudPolicyEvent.findMany({
      where: { tenantId, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      include: { ingestionJob: { select: { traceId: true } } },
    });
    return rows.map((row): AuditEvent => ({
      id: row.id,
      type: 'cloud_policy',
      event: 'cloud_egress_policy',
      outcome: row.decision,
      traceId: row.ingestionJob.traceId,
      actorUserId: null,
      documentId: row.documentId,
      ingestionJobId: row.ingestionJobId,
      attributes: {
        documentVersion: row.documentVersion,
        reasonCode: row.reasonCode,
        sensitivity: row.sensitivity,
        providerId: row.providerId,
        region: row.region,
        redactionPolicyVersion: row.redactionPolicyVersion,
      },
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private async accessEvents(tenantId: string, before: Date | undefined, take: number) {
    const rows = await this.prisma.accessAudit.findMany({
      where: { tenantId, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    });
    return rows.map((row): AuditEvent => ({
      id: row.id,
      type: 'access_change',
      event: row.eventType,
      outcome: 'completed',
      traceId: row.traceId,
      actorUserId: row.actorUserId,
      documentId: null,
      ingestionJobId: null,
      attributes: {
        targetType: row.targetType,
        targetId: row.targetId,
        before: this.stringArray(row.before),
        after: this.stringArray(row.after),
      },
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
  }
}
