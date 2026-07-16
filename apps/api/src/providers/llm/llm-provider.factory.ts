import { Injectable } from '@nestjs/common';

import { AppConfig, type Environment } from '../../config/app-config';
import { GoogleLlmProvider } from './google-llm.provider';
import type { LlmProvider } from './llm-provider';
import { LlmProviderError } from './llm-provider-error';
import { LlmTelemetry } from './llm-telemetry';
import { OpenAiCompatibleLlmProvider } from './openai-compatible-llm.provider';

type ConfiguredLlmProvider = Exclude<Environment['LLM_PROVIDER'], 'none'>;

@Injectable()
export class LlmProviderFactory {
  private readonly providers = new Map<string, LlmProvider>();

  constructor(
    private readonly config: AppConfig,
    private readonly telemetry: LlmTelemetry,
  ) {}

  getPrimary(): LlmProvider {
    const providerId = this.config.values.LLM_PROVIDER;
    if (providerId === 'none') throw new LlmProviderError('not_configured', false);
    return this.getOrCreate(providerId, this.config.values.LLM_MODEL);
  }

  getFallback(): LlmProvider | null {
    const providerId = this.config.values.LLM_FALLBACK_PROVIDER;
    if (providerId === 'none') return null;
    return this.getOrCreate(providerId, this.config.values.LLM_FALLBACK_MODEL);
  }

  private getOrCreate(providerId: ConfiguredLlmProvider, model: string): LlmProvider {
    const cacheKey = `${providerId}:${model}`;
    const existing = this.providers.get(cacheKey);
    if (existing) return existing;
    const provider =
      providerId === 'google'
        ? new GoogleLlmProvider({
            apiKey: this.config.values.GEMINI_API_KEY,
            baseUrl: this.config.values.GEMINI_BASE_URL,
            model,
            region: this.config.values.GEMINI_REGION,
            temperature: this.config.values.LLM_TEMPERATURE,
            maxOutputTokens: this.config.values.LLM_MAX_OUTPUT_TOKENS,
            requestTimeoutMs: this.config.values.LLM_REQUEST_TIMEOUT_MS,
            maxAttempts: this.config.values.LLM_MAX_ATTEMPTS,
            retryBaseDelayMs: this.config.values.LLM_RETRY_BASE_DELAY_MS,
            telemetryRecorder: (event) => this.telemetry.record(event),
          })
        : new OpenAiCompatibleLlmProvider({
            id: providerId,
            apiKey: this.apiKey(providerId),
            baseUrl: this.baseUrl(providerId),
            model,
            region: this.region(providerId),
            temperature: this.config.values.LLM_TEMPERATURE,
            maxOutputTokens: this.config.values.LLM_MAX_OUTPUT_TOKENS,
            requestTimeoutMs: this.config.values.LLM_REQUEST_TIMEOUT_MS,
            maxAttempts: this.config.values.LLM_MAX_ATTEMPTS,
            retryBaseDelayMs: this.config.values.LLM_RETRY_BASE_DELAY_MS,
            telemetryRecorder: (event) => this.telemetry.record(event),
          });
    this.providers.set(cacheKey, provider);
    return provider;
  }

  private apiKey(providerId: Exclude<ConfiguredLlmProvider, 'google'>): string {
    if (providerId === 'openai') return this.config.values.OPENAI_API_KEY;
    if (providerId === 'deepseek') return this.config.values.DEEPSEEK_API_KEY;
    if (providerId === 'alibaba') return this.config.values.DASHSCOPE_API_KEY;
    return this.config.values.CUSTOM_API_KEY;
  }

  private baseUrl(providerId: Exclude<ConfiguredLlmProvider, 'google'>): string {
    if (providerId === 'openai') return this.config.values.OPENAI_BASE_URL;
    if (providerId === 'deepseek') return this.config.values.DEEPSEEK_BASE_URL;
    if (providerId === 'alibaba') return this.config.values.ALIBABA_BASE_URL;
    return this.config.values.CUSTOM_BASE_URL;
  }

  private region(providerId: Exclude<ConfiguredLlmProvider, 'google'>): string {
    if (providerId === 'openai') return this.config.values.OPENAI_REGION;
    if (providerId === 'deepseek') return this.config.values.DEEPSEEK_REGION;
    if (providerId === 'alibaba') return this.config.values.ALIBABA_REGION;
    return this.config.values.CUSTOM_REGION;
  }
}
