import type { AppConfig } from '../config/app-config';
import type { ProviderBillingSnapshot } from '../observability/metrics.service';

export function billableProviders(config: AppConfig): ReadonlySet<string> {
  const values = config.values;
  const configured = [
    [values.LLM_PROVIDER, values.LLM_MODEL],
    [values.LLM_FALLBACK_PROVIDER, values.LLM_FALLBACK_MODEL],
    values.EMBEDDING_PROVIDER === 'ollama'
      ? ['none', '']
      : [values.EMBEDDING_PROVIDER, values.EMBEDDING_MODEL],
    values.RERANK_PROVIDER === 'alibaba'
      ? [values.RERANK_PROVIDER, values.RERANK_MODEL]
      : ['none', ''],
  ] as const;
  const providerModels = new Set(
    configured.flatMap(([provider, model]) =>
      provider === 'none' || !model ? [] : [`${provider}:${model}`],
    ),
  );
  const pricing = values.MODEL_PRICING_USD_PER_MILLION_TOKENS_JSON;
  const missing = [...providerModels].filter((providerModel) => !pricing[providerModel]);
  if (missing.length > 0) {
    throw new Error(`Quality capture requires explicit pricing for ${missing.join(', ')}`);
  }
  return providerModels;
}

export function billingDelta(
  before: ProviderBillingSnapshot,
  after: ProviderBillingSnapshot,
): number | null {
  const successfulRequests = after.successfulRequests - before.successfulRequests;
  if (successfulRequests === 0) return 0;
  if (after.reportedTokens - before.reportedTokens <= 0) return null;
  return Math.max(0, Number((after.estimatedCostUsd - before.estimatedCostUsd).toFixed(12)));
}
