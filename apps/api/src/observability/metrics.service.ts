import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

import { AppConfig } from '../config/app-config';

type ProviderKind = 'embedding' | 'llm' | 'rerank';

export type KnowledgeQueryPhase =
  | 'rate_limit'
  | 'history_read'
  | 'query_embedding'
  | 'vector_retrieval'
  | 'rerank'
  | 'source_auth_before_llm'
  | 'llm'
  | 'source_auth_before_return'
  | 'audit_write'
  | 'history_write';

export type LlmCitationEvent =
  | 'valid'
  | 'empty'
  | 'insufficient'
  | 'missing'
  | 'out_of_range'
  | 'repair_started'
  | 'repair_succeeded'
  | 'repair_failed';

interface ProviderMetricEvent {
  provider: string;
  model: string;
  durationMs: number;
  attempts?: number;
  status: 'success' | 'error';
  errorKind?: string;
  inputTokens?: number;
  cacheHitInputTokens?: number;
  cacheMissInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ProviderBillingSnapshot {
  estimatedCostUsd: number;
  successfulRequests: number;
  reportedTokens: number;
}

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  private readonly httpRequests: Counter<'method' | 'route' | 'status_class'>;
  private readonly httpDuration: Histogram<'method' | 'route' | 'status_class'>;
  private readonly providerRequests: Counter<
    'kind' | 'provider' | 'model' | 'status' | 'error_kind'
  >;
  private readonly providerDuration: Histogram<'kind' | 'provider' | 'model' | 'status'>;
  private readonly providerRetries: Counter<'kind' | 'provider' | 'model'>;
  private readonly providerTokens: Counter<'kind' | 'provider' | 'model' | 'token_type'>;
  private readonly providerCost: Counter<'kind' | 'provider' | 'model'>;
  private readonly parserRequests: Counter<'status' | 'error_kind'>;
  private readonly parserDuration: Histogram<'status'>;
  private readonly parserOcrWarnings: Counter;
  private readonly cadPreviewTiles: Counter<'zoom' | 'cache' | 'status'>;
  private readonly cadPreviewTileDuration: Histogram<'zoom' | 'cache' | 'status'>;
  private readonly ingestionJobs: Counter<'status'>;
  private readonly ingestionDuration: Histogram<'status'>;
  private readonly queueJobs: Gauge<'state'>;
  private readonly queueOldestWait: Gauge;
  private readonly retrievalResults: Counter<'outcome'>;
  private readonly knowledgeQueryPhaseDuration: Histogram<'phase' | 'status'>;
  private readonly llmCitationEvents: Counter<'event'>;
  private readonly embeddingCacheRequests: Counter<'operation' | 'outcome'>;
  private readonly rerankDegradations: Counter<'reason'>;
  private readonly rateLimits: Counter<'scope'>;
  private readonly dependencyHealth: Gauge<'component'>;
  private readonly diskUsageRatio: Gauge<'path'>;

  constructor(private readonly config: AppConfig) {
    collectDefaultMetrics({ register: this.registry, prefix: 'nexuskb_' });
    this.httpRequests = this.counter(
      'nexuskb_http_requests_total',
      'HTTP requests by stable route template and status class.',
      ['method', 'route', 'status_class'],
    );
    this.httpDuration = this.histogram(
      'nexuskb_http_request_duration_seconds',
      'HTTP request duration by stable route template.',
      ['method', 'route', 'status_class'],
      [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    );
    this.providerRequests = this.counter(
      'nexuskb_provider_requests_total',
      'Cloud provider calls including rate limits, timeouts, and service errors.',
      ['kind', 'provider', 'model', 'status', 'error_kind'],
    );
    this.providerDuration = this.histogram(
      'nexuskb_provider_request_duration_seconds',
      'Cloud provider request duration.',
      ['kind', 'provider', 'model', 'status'],
      [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
    );
    this.providerRetries = this.counter(
      'nexuskb_provider_retries_total',
      'Cloud provider retry attempts after the initial request.',
      ['kind', 'provider', 'model'],
    );
    this.providerTokens = this.counter(
      'nexuskb_provider_tokens_total',
      'Provider token usage reported by the provider.',
      ['kind', 'provider', 'model', 'token_type'],
    );
    this.providerCost = this.counter(
      'nexuskb_provider_estimated_cost_usd_total',
      'Estimated provider cost from configured per-million-token prices.',
      ['kind', 'provider', 'model'],
    );
    this.parserRequests = this.counter(
      'nexuskb_parser_requests_total',
      'Parser worker calls by outcome.',
      ['status', 'error_kind'],
    );
    this.parserDuration = this.histogram(
      'nexuskb_parser_request_duration_seconds',
      'Parser worker request duration.',
      ['status'],
      [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600],
    );
    this.parserOcrWarnings = this.counter(
      'nexuskb_parser_ocr_warnings_total',
      'OCR-related warnings returned by the parser worker.',
      [],
    );
    this.cadPreviewTiles = this.counter(
      'nexuskb_cad_preview_tiles_total',
      'CAD preview tile requests by bounded zoom, cache outcome, and status.',
      ['zoom', 'cache', 'status'],
    );
    this.cadPreviewTileDuration = this.histogram(
      'nexuskb_cad_preview_tile_duration_seconds',
      'CAD preview tile worker duration, including cache lookup or on-demand rendering.',
      ['zoom', 'cache', 'status'],
      [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    );
    this.ingestionJobs = this.counter(
      'nexuskb_ingestion_jobs_total',
      'Completed ingestion attempts by outcome.',
      ['status'],
    );
    this.ingestionDuration = this.histogram(
      'nexuskb_ingestion_job_duration_seconds',
      'Ingestion processing duration per BullMQ delivery.',
      ['status'],
      [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600, 1800],
    );
    this.queueJobs = this.gauge(
      'nexuskb_ingestion_queue_jobs',
      'Current ingestion queue jobs by state.',
      ['state'],
    );
    this.queueOldestWait = this.gauge(
      'nexuskb_ingestion_queue_oldest_wait_seconds',
      'Age of the oldest waiting or delayed ingestion job.',
      [],
    );
    this.retrievalResults = this.counter(
      'nexuskb_retrieval_results_total',
      'Knowledge retrieval attempts by empty or non-empty outcome.',
      ['outcome'],
    );
    this.knowledgeQueryPhaseDuration = this.histogram(
      'nexuskb_knowledge_query_phase_duration_seconds',
      'Knowledge query duration by bounded pipeline phase and outcome.',
      ['phase', 'status'],
      [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
    );
    this.llmCitationEvents = this.counter(
      'nexuskb_llm_citation_events_total',
      'Grounded LLM citation validation and repair events.',
      ['event'],
    );
    this.embeddingCacheRequests = this.counter(
      'nexuskb_embedding_cache_requests_total',
      'Embedding cache requests by operation and hit outcome.',
      ['operation', 'outcome'],
    );
    this.rerankDegradations = this.counter(
      'nexuskb_rerank_degradations_total',
      'Rerank fallback to vector order by bounded reason.',
      ['reason'],
    );
    this.rateLimits = this.counter(
      'nexuskb_rate_limit_rejections_total',
      'Rate-limit rejections by bounded scope.',
      ['scope'],
    );
    this.dependencyHealth = this.gauge(
      'nexuskb_dependency_up',
      'Dependency health from the latest metrics scrape (1 is up).',
      ['component'],
    );
    this.diskUsageRatio = this.gauge(
      'nexuskb_disk_usage_ratio',
      'Disk usage ratio for the configured raw-document volume.',
      ['path'],
    );
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  async providerBillingSnapshot(
    providerModels: ReadonlySet<string>,
  ): Promise<ProviderBillingSnapshot> {
    const [requests, tokens, costs] = await Promise.all([
      this.providerRequests.get(),
      this.providerTokens.get(),
      this.providerCost.get(),
    ]);
    const includes = (labels: Record<string, string | number>) =>
      providerModels.has(`${String(labels.provider)}:${String(labels.model)}`);
    return {
      estimatedCostUsd: costs.values
        .filter((value) => includes(value.labels))
        .reduce((sum, value) => sum + value.value, 0),
      successfulRequests: requests.values
        .filter((value) => includes(value.labels) && value.labels.status === 'success')
        .reduce((sum, value) => sum + value.value, 0),
      reportedTokens: tokens.values
        .filter((value) => includes(value.labels))
        .reduce((sum, value) => sum + value.value, 0),
    };
  }

  observeHttp(method: string, route: string, statusCode: number, durationMs: number): void {
    const labels = {
      method: method.toUpperCase(),
      route,
      status_class: `${Math.floor(statusCode / 100)}xx`,
    };
    this.httpRequests.inc(labels);
    this.httpDuration.observe(labels, durationMs / 1000);
  }

  observeProvider(kind: ProviderKind, event: ProviderMetricEvent): void {
    const errorKind = event.errorKind ?? 'none';
    const common = { kind, provider: event.provider, model: event.model };
    this.providerRequests.inc({ ...common, status: event.status, error_kind: errorKind });
    this.providerDuration.observe({ ...common, status: event.status }, event.durationMs / 1000);
    const retries = Math.max(0, (event.attempts ?? 1) - 1);
    if (retries > 0) this.providerRetries.inc(common, retries);
    this.observeTokens(common, event);
    const estimatedCost = this.estimatedCost(event.provider, event.model, event);
    if (estimatedCost > 0) this.providerCost.inc(common, estimatedCost);
  }

  observeParser(status: 'success' | 'error', durationMs: number, errorKind = 'none'): void {
    this.parserRequests.inc({ status, error_kind: errorKind });
    this.parserDuration.observe({ status }, durationMs / 1000);
  }

  addParserWarnings(warnings: string[]): void {
    const count = warnings.filter((warning) => warning.toUpperCase().includes('OCR')).length;
    if (count > 0) this.parserOcrWarnings.inc(count);
  }

  observeCadPreviewTile(
    zoom: number,
    cache: 'hit' | 'miss' | 'unknown',
    status: 'success' | 'error',
    durationMs: number,
  ): void {
    const labels = {
      zoom: String(Math.min(15, Math.max(0, Math.trunc(zoom)))),
      cache,
      status,
    };
    this.cadPreviewTiles.inc(labels);
    this.cadPreviewTileDuration.observe(labels, durationMs / 1000);
  }

  observeIngestion(status: 'completed' | 'failed', durationMs: number): void {
    this.ingestionJobs.inc({ status });
    this.ingestionDuration.observe({ status }, durationMs / 1000);
  }

  setQueueSnapshot(counts: Record<string, number>, oldestWaitSeconds: number): void {
    for (const state of ['waiting', 'active', 'delayed', 'failed'] as const) {
      this.queueJobs.set({ state }, counts[state] ?? 0);
    }
    this.queueOldestWait.set(Math.max(0, oldestWaitSeconds));
  }

  observeRetrieval(resultCount: number): void {
    this.retrievalResults.inc({ outcome: resultCount === 0 ? 'empty' : 'non_empty' });
  }

  observeKnowledgeQueryPhase(
    phase: KnowledgeQueryPhase,
    status: 'success' | 'error',
    durationMs: number,
  ): void {
    this.knowledgeQueryPhaseDuration.observe({ phase, status }, durationMs / 1000);
  }

  observeLlmCitationEvent(event: LlmCitationEvent): void {
    this.llmCitationEvents.inc({ event });
  }

  observeEmbeddingCache(
    operation: 'documents' | 'query',
    outcome: 'hit' | 'partial' | 'miss',
  ): void {
    this.embeddingCacheRequests.inc({ operation, outcome });
  }

  observeRerankDegradation(reason: string): void {
    const boundedReason = ['disabled', 'policy_denied', 'provider_error'].includes(reason)
      ? reason
      : 'provider_error';
    this.rerankDegradations.inc({ reason: boundedReason });
  }

  observeRateLimit(scope: 'user_or_tenant'): void {
    this.rateLimits.inc({ scope });
  }

  setDependencyHealth(checks: Record<string, { status: 'up' | 'down' }>): void {
    for (const [component, check] of Object.entries(checks)) {
      this.dependencyHealth.set({ component }, check.status === 'up' ? 1 : 0);
    }
  }

  setDiskUsage(ratio: number): void {
    this.diskUsageRatio.set({ path: 'raw_docs' }, Math.min(1, Math.max(0, ratio)));
  }

  private observeTokens(
    labels: { kind: ProviderKind; provider: string; model: string },
    event: ProviderMetricEvent,
  ): void {
    if (event.inputTokens !== undefined) {
      this.providerTokens.inc({ ...labels, token_type: 'input' }, event.inputTokens);
    }
    if (event.outputTokens !== undefined) {
      this.providerTokens.inc({ ...labels, token_type: 'output' }, event.outputTokens);
    }
    if (event.totalTokens !== undefined) {
      this.providerTokens.inc({ ...labels, token_type: 'total' }, event.totalTokens);
    }
    if (event.cacheHitInputTokens !== undefined) {
      this.providerTokens.inc(
        { ...labels, token_type: 'cache_hit_input' },
        event.cacheHitInputTokens,
      );
    }
    if (event.cacheMissInputTokens !== undefined) {
      this.providerTokens.inc(
        { ...labels, token_type: 'cache_miss_input' },
        event.cacheMissInputTokens,
      );
    }
  }

  private estimatedCost(provider: string, model: string, event: ProviderMetricEvent): number {
    const pricing =
      this.config.values.MODEL_PRICING_USD_PER_MILLION_TOKENS_JSON[`${provider}:${model}`];
    if (!pricing) return 0;
    const input =
      event.inputTokens ?? Math.max(0, (event.totalTokens ?? 0) - (event.outputTokens ?? 0));
    const output = event.outputTokens ?? 0;
    if (
      event.cacheHitInputTokens !== undefined &&
      event.cacheMissInputTokens !== undefined &&
      pricing.cacheHitInput !== undefined &&
      pricing.cacheMissInput !== undefined
    ) {
      return (
        (event.cacheHitInputTokens * pricing.cacheHitInput +
          event.cacheMissInputTokens * pricing.cacheMissInput +
          output * pricing.output) /
        1_000_000
      );
    }
    return (input * pricing.input + output * pricing.output) / 1_000_000;
  }

  private counter<L extends string>(name: string, help: string, labelNames: L[]): Counter<L> {
    return new Counter({ name, help, labelNames, registers: [this.registry] });
  }

  private gauge<L extends string>(name: string, help: string, labelNames: L[]): Gauge<L> {
    return new Gauge({ name, help, labelNames, registers: [this.registry] });
  }

  private histogram<L extends string>(
    name: string,
    help: string,
    labelNames: L[],
    buckets: number[],
  ): Histogram<L> {
    return new Histogram({ name, help, labelNames, buckets, registers: [this.registry] });
  }
}
