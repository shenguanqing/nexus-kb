import { Injectable } from '@nestjs/common';
import type { UsageQueryRequest, UsageResponse } from '@nexus-kb/contracts';

import { AclPolicy } from '../auth/acl-policy';
import { isAdmin } from '../auth/app-role';
import type { Identity } from '../auth/identity';
import { ApiException } from '../common/api-exception';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly acl: AclPolicy,
    private readonly config: AppConfig,
  ) {}

  async query(request: UsageQueryRequest, identity: Identity): Promise<UsageResponse> {
    this.acl.assertCapability(identity, 'system:read');
    if (!isAdmin(identity.roles)) {
      throw new ApiException('ADMIN_REQUIRED', '需要管理员权限', 403);
    }
    const rows = await this.prisma.queryAudit.findMany({
      where: {
        tenantId: identity.tenantId,
        createdAt: { gte: new Date(request.from), lte: new Date(request.to) },
      },
      select: {
        outcome: true,
        durationMs: true,
        department: true,
        embeddingProvider: true,
        embeddingModel: true,
        rerankProvider: true,
        rerankModel: true,
        llmProvider: true,
        llmModel: true,
      },
    });
    const providerMap = new Map<
      string,
      {
        kind: 'embedding' | 'rerank' | 'llm';
        provider: string;
        model: string;
        requests: number;
        failures: number;
      }
    >();
    for (const row of rows) {
      this.addProvider(
        providerMap,
        'embedding',
        row.embeddingProvider,
        row.embeddingModel,
        row.outcome,
      );
      this.addProvider(providerMap, 'rerank', row.rerankProvider, row.rerankModel, row.outcome);
      this.addProvider(providerMap, 'llm', row.llmProvider, row.llmModel, row.outcome);
    }
    this.addCurrentEmbeddingConfiguration(providerMap);
    const departmentCounts = new Map<string, number>();
    for (const row of rows) {
      if (row.department)
        departmentCounts.set(row.department, (departmentCounts.get(row.department) ?? 0) + 1);
    }
    const durations = rows.map((row) => row.durationMs).sort((a, b) => a - b);
    const failures = rows.filter((row) => row.outcome === 'failed').length;
    return {
      from: request.from,
      to: request.to,
      totalQueries: rows.length,
      failureRate: rows.length > 0 ? failures / rows.length : null,
      queryP95Ms: durations.length > 0 ? durations[Math.ceil(durations.length * 0.95) - 1]! : null,
      providers: [...providerMap.values()]
        .sort((left, right) =>
          `${left.kind}:${left.provider}:${left.model}`.localeCompare(
            `${right.kind}:${right.provider}:${right.model}`,
          ),
        )
        .map((row) => ({ ...row, inputTokens: null, outputTokens: null, estimatedCostUsd: null })),
      departments: [...departmentCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([department, requests]) => ({ department, requests })),
      usageCompleteness: 'request_only',
    };
  }

  private addCurrentEmbeddingConfiguration(
    map: Map<
      string,
      {
        kind: 'embedding' | 'rerank' | 'llm';
        provider: string;
        model: string;
        requests: number;
        failures: number;
      }
    >,
  ): void {
    const provider = this.config.values.EMBEDDING_PROVIDER;
    const model = this.config.values.EMBEDDING_MODEL;
    if (provider === 'none' || !model) return;
    const key = `embedding:${provider}:${model}`;
    if (!map.has(key)) {
      map.set(key, { kind: 'embedding', provider, model, requests: 0, failures: 0 });
    }
  }

  private addProvider(
    map: Map<
      string,
      {
        kind: 'embedding' | 'rerank' | 'llm';
        provider: string;
        model: string;
        requests: number;
        failures: number;
      }
    >,
    kind: 'embedding' | 'rerank' | 'llm',
    provider: string | null,
    model: string | null,
    outcome: string,
  ): void {
    if (!provider || !model || provider === 'none') return;
    const key = `${kind}:${provider}:${model}`;
    const current = map.get(key) ?? { kind, provider, model, requests: 0, failures: 0 };
    current.requests += 1;
    if (outcome === 'failed') current.failures += 1;
    map.set(key, current);
  }
}
