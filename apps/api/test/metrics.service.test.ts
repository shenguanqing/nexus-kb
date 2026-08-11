import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../src/config/app-config';
import { MetricsService } from '../src/observability/metrics.service';

function service(): MetricsService {
  return new MetricsService({
    values: {
      MODEL_PRICING_USD_PER_MILLION_TOKENS_JSON: {
        'deepseek:model-a': {
          input: 1,
          output: 2,
          cacheHitInput: 0.1,
          cacheMissInput: 1,
        },
      },
    },
  } as unknown as AppConfig);
}

describe('MetricsService', () => {
  it('exports low-cardinality HTTP and provider metrics with usage and configured cost', async () => {
    const metrics = service();
    metrics.observeHttp('get', '/v1/documents/:documentId', 200, 125);
    metrics.observeProvider('llm', {
      provider: 'deepseek',
      model: 'model-a',
      durationMs: 500,
      attempts: 3,
      status: 'success',
      inputTokens: 100,
      cacheHitInputTokens: 80,
      cacheMissInputTokens: 20,
      outputTokens: 50,
      totalTokens: 150,
    });
    metrics.observeProvider('llm', {
      provider: 'other',
      model: 'ignored',
      durationMs: 50,
      status: 'success',
      totalTokens: 500,
    });
    const output = await metrics.render();
    const billing = await metrics.providerBillingSnapshot(new Set(['deepseek:model-a']));

    expect(output).toContain('route="/v1/documents/:documentId"');
    expect(output).toContain(
      'nexuskb_provider_retries_total{kind="llm",provider="deepseek",model="model-a"} 2',
    );
    expect(output).toContain(
      'nexuskb_provider_tokens_total{kind="llm",provider="deepseek",model="model-a",token_type="input"} 100',
    );
    expect(output).toContain(
      'nexuskb_provider_estimated_cost_usd_total{kind="llm",provider="deepseek",model="model-a"} 0.000128',
    );
    expect(billing).toEqual({
      estimatedCostUsd: 0.000128,
      successfulRequests: 1,
      reportedTokens: 400,
    });
    expect(output).not.toContain('documentId=');
    expect(output).not.toContain('traceId=');
    expect(output).not.toContain('userId=');
  });

  it('tracks parser, queue, retrieval, degradation, and dependency state', async () => {
    const metrics = service();
    metrics.observeParser('error', 1000, 'timeout');
    metrics.addParserWarnings(['OCR_LOW_CONFIDENCE', 'TABLE_WARNING']);
    metrics.observeIngestion('failed', 2000);
    metrics.setQueueSnapshot({ waiting: 2, active: 1, delayed: 0, failed: 3 }, 45);
    metrics.observeRetrieval(0);
    metrics.observeRerankDegradation('policy_denied');
    metrics.setDependencyHealth({ chroma: { status: 'up' } });
    metrics.setDiskUsage(0.75);
    const output = await metrics.render();

    expect(output).toContain(
      'nexuskb_parser_requests_total{status="error",error_kind="timeout"} 1',
    );
    expect(output).toContain('nexuskb_parser_ocr_warnings_total 1');
    expect(output).toContain('nexuskb_ingestion_queue_jobs{state="failed"} 3');
    expect(output).toContain('nexuskb_retrieval_results_total{outcome="empty"} 1');
    expect(output).toContain('nexuskb_dependency_up{component="chroma"} 1');
    expect(output).toContain('nexuskb_disk_usage_ratio{path="raw_docs"} 0.75');
  });
});
