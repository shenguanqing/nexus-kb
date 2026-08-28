import { Injectable } from '@nestjs/common';
import type { UsageQueryRequest, UsageResponse } from '@nexus-kb/contracts';

import { AclPolicy } from '../auth/acl-policy';
import { isAdmin } from '../auth/app-role';
import type { Identity } from '../auth/identity';
import { ApiException } from '../common/api-exception';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';

type ProviderKind = 'embedding' | 'rerank' | 'llm';

interface ProviderAggregate {
  kind: ProviderKind;
  provider: string;
  model: string;
  requests: number;
  failures: number;
}

interface ProviderUsageAggregate {
  queryStatuses: Map<string, Set<string>>;
  facts: Array<{
    status: string;
    inputTokens: number | null;
    outputTokens: number | null;
    estimatedCostUsd: unknown;
  }>;
}

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
    const range = { gte: new Date(request.from), lte: new Date(request.to) };
    const [rows, usageFacts] = await Promise.all([
      this.prisma.queryAudit.findMany({
        where: { tenantId: identity.tenantId, createdAt: range },
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
      }),
      this.prisma.queryProviderUsage.findMany({
        where: { tenantId: identity.tenantId, createdAt: range },
        select: {
          queryTraceId: true,
          kind: true,
          provider: true,
          model: true,
          status: true,
          inputTokens: true,
          outputTokens: true,
          estimatedCostUsd: true,
        },
      }),
    ]);
    const providerMap = new Map<string, ProviderAggregate>();
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
    const usageMap = this.aggregateUsageFacts(usageFacts);
    this.addUsageOnlyProviders(providerMap, usageMap);
    this.addCurrentEmbeddingConfiguration(providerMap);
    const departmentCounts = new Map<string, number>();
    for (const row of rows) {
      if (row.department)
        departmentCounts.set(row.department, (departmentCounts.get(row.department) ?? 0) + 1);
    }
    const durations = rows.map((row) => row.durationMs).sort((a, b) => a - b);
    const failures = rows.filter((row) => row.outcome === 'failed').length;
    const providers = [...providerMap.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, row]) => ({ ...row, ...this.usageValues(row.kind, usageMap.get(key)) }));
    const completeProviders = providers.filter((provider) => provider.requests > 0);
    const hasCompleteUsage =
      completeProviders.length > 0 &&
      completeProviders.every(
        (provider) =>
          provider.inputTokens !== null &&
          provider.estimatedCostUsd !== null &&
          (provider.kind !== 'llm' || provider.outputTokens !== null),
      );
    return {
      from: request.from,
      to: request.to,
      totalQueries: rows.length,
      failureRate: rows.length > 0 ? failures / rows.length : null,
      queryP50Ms: durations.length > 0 ? durations[Math.ceil(durations.length * 0.5) - 1]! : null,
      queryP95Ms: durations.length > 0 ? durations[Math.ceil(durations.length * 0.95) - 1]! : null,
      providers,
      departments: [...departmentCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([department, requests]) => ({ department, requests })),
      usageCompleteness: hasCompleteUsage ? 'tokens_and_cost' : 'request_only',
    };
  }

  private aggregateUsageFacts(
    facts: Array<{
      queryTraceId: string;
      kind: string;
      provider: string;
      model: string;
      status: string;
      inputTokens: number | null;
      outputTokens: number | null;
      estimatedCostUsd: unknown;
    }>,
  ): Map<string, ProviderUsageAggregate> {
    const aggregates = new Map<string, ProviderUsageAggregate>();
    for (const fact of facts) {
      if (!this.isProviderKind(fact.kind)) continue;
      const key = `${fact.kind}:${fact.provider}:${fact.model}`;
      const aggregate: ProviderUsageAggregate = aggregates.get(key) ?? {
        queryStatuses: new Map(),
        facts: [],
      };
      const statuses = aggregate.queryStatuses.get(fact.queryTraceId) ?? new Set<string>();
      statuses.add(fact.status);
      aggregate.queryStatuses.set(fact.queryTraceId, statuses);
      aggregate.facts.push(fact);
      aggregates.set(key, aggregate);
    }
    return aggregates;
  }

  private addUsageOnlyProviders(
    providers: Map<string, ProviderAggregate>,
    usage: Map<string, ProviderUsageAggregate>,
  ): void {
    for (const [key, aggregate] of usage) {
      if (providers.has(key)) continue;
      const [kind, provider, ...modelParts] = key.split(':');
      if (!this.isProviderKind(kind) || !provider || modelParts.length === 0) continue;
      providers.set(key, {
        kind,
        provider,
        model: modelParts.join(':'),
        requests: aggregate.queryStatuses.size,
        failures: [...aggregate.queryStatuses.values()].filter(
          (statuses) => !statuses.has('success'),
        ).length,
      });
    }
  }

  private usageValues(
    kind: ProviderKind,
    aggregate?: ProviderUsageAggregate,
  ): { inputTokens: number | null; outputTokens: number | null; estimatedCostUsd: number | null } {
    if (!aggregate) return { inputTokens: null, outputTokens: null, estimatedCostUsd: null };
    const successful = aggregate.facts.filter((fact) => fact.status === 'success');
    const inputComplete =
      successful.length > 0 && successful.every((fact) => fact.inputTokens !== null);
    const outputComplete =
      kind === 'llm' &&
      successful.length > 0 &&
      successful.every((fact) => fact.outputTokens !== null);
    const costComplete =
      successful.length > 0 && successful.every((fact) => fact.estimatedCostUsd !== null);
    return {
      inputTokens: inputComplete
        ? aggregate.facts.reduce((sum, fact) => sum + (fact.inputTokens ?? 0), 0)
        : null,
      outputTokens: outputComplete
        ? aggregate.facts.reduce((sum, fact) => sum + (fact.outputTokens ?? 0), 0)
        : null,
      estimatedCostUsd: costComplete
        ? Number(
            aggregate.facts
              .reduce((sum, fact) => sum + Number(fact.estimatedCostUsd ?? 0), 0)
              .toFixed(12),
          )
        : null,
    };
  }

  private isProviderKind(value: unknown): value is ProviderKind {
    return value === 'embedding' || value === 'rerank' || value === 'llm';
  }

  private addCurrentEmbeddingConfiguration(map: Map<string, ProviderAggregate>): void {
    const provider = this.config.values.EMBEDDING_PROVIDER;
    const model = this.config.values.EMBEDDING_MODEL;
    if (provider === 'none' || !model) return;
    const key = `embedding:${provider}:${model}`;
    if (!map.has(key)) {
      map.set(key, { kind: 'embedding', provider, model, requests: 0, failures: 0 });
    }
  }

  private addProvider(
    map: Map<string, ProviderAggregate>,
    kind: ProviderKind,
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
