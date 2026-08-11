import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

import type { Identity } from '../auth/identity';
import { AppConfig } from '../config/app-config';

export type QueryProviderKind = 'embedding' | 'rerank' | 'llm';

export interface QueryProviderMetricEvent {
  provider: string;
  model: string;
  status: 'success' | 'error';
  inputTokens?: number;
  cacheHitInputTokens?: number;
  cacheMissInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface QueryProviderUsageFact {
  id: string;
  queryTraceId: string;
  tenantId: string;
  kind: QueryProviderKind;
  provider: string;
  model: string;
  status: 'success' | 'error';
  inputTokens: number | null;
  cacheHitInputTokens: number | null;
  cacheMissInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
}

interface QueryUsageScope {
  traceId: string;
  tenantId: string;
  facts: QueryProviderUsageFact[];
}

@Injectable()
export class QueryProviderUsageContext {
  private readonly storage = new AsyncLocalStorage<QueryUsageScope>();

  constructor(private readonly config: AppConfig) {}

  run<T>(identity: Identity, traceId: string, callback: () => Promise<T>): Promise<T> {
    return this.storage.run({ traceId, tenantId: identity.tenantId, facts: [] }, callback);
  }

  record(kind: QueryProviderKind, event: QueryProviderMetricEvent): void {
    const scope = this.storage.getStore();
    if (!scope) return;
    const inputTokens = this.inputTokens(kind, event);
    const outputTokens = this.outputTokens(kind, event, inputTokens);
    const totalTokens = event.totalTokens ?? this.totalTokens(inputTokens, outputTokens);
    scope.facts.push({
      id: randomUUID(),
      queryTraceId: scope.traceId,
      tenantId: scope.tenantId,
      kind,
      provider: event.provider,
      model: event.model,
      status: event.status,
      inputTokens,
      cacheHitInputTokens: event.cacheHitInputTokens ?? null,
      cacheMissInputTokens: event.cacheMissInputTokens ?? null,
      outputTokens,
      totalTokens,
      estimatedCostUsd: this.estimatedCost(event, inputTokens, outputTokens),
    });
  }

  facts(traceId: string): QueryProviderUsageFact[] {
    const scope = this.storage.getStore();
    if (!scope || scope.traceId !== traceId) return [];
    return scope.facts.map((fact) => ({ ...fact }));
  }

  private inputTokens(kind: QueryProviderKind, event: QueryProviderMetricEvent): number | null {
    if (event.inputTokens !== undefined) return event.inputTokens;
    if (event.cacheHitInputTokens !== undefined && event.cacheMissInputTokens !== undefined) {
      return event.cacheHitInputTokens + event.cacheMissInputTokens;
    }
    if (event.totalTokens === undefined) return null;
    if (kind !== 'llm') return event.totalTokens;
    if (event.outputTokens === undefined) return null;
    return Math.max(0, event.totalTokens - event.outputTokens);
  }

  private outputTokens(
    kind: QueryProviderKind,
    event: QueryProviderMetricEvent,
    inputTokens: number | null,
  ): number | null {
    if (kind !== 'llm') return null;
    if (event.outputTokens !== undefined) return event.outputTokens;
    if (event.totalTokens === undefined || inputTokens === null) return null;
    return Math.max(0, event.totalTokens - inputTokens);
  }

  private totalTokens(inputTokens: number | null, outputTokens: number | null): number | null {
    if (inputTokens === null && outputTokens === null) return null;
    return (inputTokens ?? 0) + (outputTokens ?? 0);
  }

  private estimatedCost(
    event: QueryProviderMetricEvent,
    inputTokens: number | null,
    outputTokens: number | null,
  ): number | null {
    const pricing =
      this.config.values.MODEL_PRICING_USD_PER_MILLION_TOKENS_JSON[
        `${event.provider}:${event.model}`
      ];
    if (!pricing || inputTokens === null) return null;
    let inputCost = inputTokens * pricing.input;
    if (
      event.cacheHitInputTokens !== undefined &&
      event.cacheMissInputTokens !== undefined &&
      pricing.cacheHitInput !== undefined &&
      pricing.cacheMissInput !== undefined
    ) {
      inputCost =
        event.cacheHitInputTokens * pricing.cacheHitInput +
        event.cacheMissInputTokens * pricing.cacheMissInput;
    }
    return (inputCost + (outputTokens ?? 0) * pricing.output) / 1_000_000;
  }
}
