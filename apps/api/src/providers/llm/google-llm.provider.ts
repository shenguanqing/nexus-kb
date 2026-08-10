import { z } from 'zod';

import {
  buildKnowledgePrompt,
  GENERAL_KNOWLEDGE_SYSTEM_PROMPT,
  KNOWLEDGE_SYSTEM_PROMPT,
} from './llm-prompt';
import type { LlmAnswer, LlmAnswerInput, LlmProvider, LlmTelemetryEvent } from './llm-provider';
import { LlmProviderError } from './llm-provider-error';

const responseSchema = z
  .object({
    candidates: z.array(
      z.object({
        content: z.object({
          parts: z.array(z.object({ text: z.string().optional() }).passthrough()),
        }),
      }),
    ),
    usageMetadata: z
      .object({
        promptTokenCount: z.number().int().nonnegative().optional(),
        candidatesTokenCount: z.number().int().nonnegative().optional(),
        totalTokenCount: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
    responseId: z.string().optional(),
  })
  .passthrough();

export interface GoogleLlmOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  region: string;
  temperature: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  fetchFunction?: typeof fetch;
  sleepFunction?: (durationMs: number) => Promise<void>;
  randomFunction?: () => number;
  nowFunction?: () => number;
  telemetryRecorder?: (event: LlmTelemetryEvent) => void;
}

export class GoogleLlmProvider implements LlmProvider {
  readonly id = 'google';
  readonly model: string;
  readonly region: string;

  private readonly fetchFunction: typeof fetch;
  private readonly nowFunction: () => number;
  private readonly telemetryRecorder: (event: LlmTelemetryEvent) => void;
  private readonly sleepFunction: (durationMs: number) => Promise<void>;
  private readonly randomFunction: () => number;
  private readonly endpoint: string;

  constructor(private readonly options: GoogleLlmOptions) {
    this.model = options.model;
    this.region = options.region;
    this.fetchFunction = options.fetchFunction ?? fetch;
    this.sleepFunction =
      options.sleepFunction ??
      ((durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)));
    this.randomFunction = options.randomFunction ?? Math.random;
    this.nowFunction = options.nowFunction ?? Date.now;
    this.telemetryRecorder = options.telemetryRecorder ?? (() => undefined);
    this.endpoint = `${options.baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(options.model)}:generateContent`;
  }

  async answer(input: LlmAnswerInput): Promise<LlmAnswer> {
    if (
      !input.question.trim() ||
      (input.mode === 'grounded' && input.contexts.length === 0) ||
      (input.mode === 'general' && input.contexts.length > 0)
    ) {
      throw new LlmProviderError('invalid_request', false);
    }
    const startedAt = this.nowFunction();
    let lastError: LlmProviderError | undefined;
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.requestTimeoutMs);
      try {
        const response = await this.fetchFunction(this.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': this.options.apiKey,
            'x-request-id': input.traceId,
          },
          body: JSON.stringify({
            system_instruction: {
              parts: [
                {
                  text:
                    input.mode === 'general'
                      ? GENERAL_KNOWLEDGE_SYSTEM_PROMPT
                      : KNOWLEDGE_SYSTEM_PROMPT,
                },
              ],
            },
            contents: [{ role: 'user', parts: [{ text: buildKnowledgePrompt(input) }] }],
            generationConfig: this.generationConfig(),
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw this.mapStatus(response.status);
        let responseBody: unknown;
        try {
          responseBody = await response.json();
        } catch (error) {
          if (
            controller.signal.aborted ||
            (error instanceof Error && error.name === 'AbortError')
          ) {
            throw new LlmProviderError('timeout', true, { cause: error });
          }
          throw new LlmProviderError('invalid_response', false, { cause: error });
        }
        const parsed = responseSchema.safeParse(responseBody);
        const text = parsed.success
          ? parsed.data.candidates[0]?.content.parts
              .map((part) => part.text ?? '')
              .join('')
              .trim()
          : '';
        if (!parsed.success || !text) throw new LlmProviderError('invalid_response', false);
        const usage = {
          inputTokens: parsed.data.usageMetadata?.promptTokenCount,
          outputTokens: parsed.data.usageMetadata?.candidatesTokenCount,
          totalTokens: parsed.data.usageMetadata?.totalTokenCount,
        };
        this.telemetryRecorder({
          provider: this.id,
          model: this.model,
          region: this.region,
          requestId: parsed.data.responseId,
          durationMs: this.nowFunction() - startedAt,
          attempts: attempt,
          ...usage,
          contextCount: input.contexts.length,
          status: 'success',
        });
        return { text, usage, requestId: parsed.data.responseId };
      } catch (error) {
        lastError =
          error instanceof LlmProviderError
            ? error
            : controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')
              ? new LlmProviderError('timeout', true, { cause: error })
              : new LlmProviderError('unavailable', true, { cause: error });
        if (!lastError.retryable || attempt === this.options.maxAttempts) {
          this.telemetryRecorder({
            provider: this.id,
            model: this.model,
            region: this.region,
            durationMs: this.nowFunction() - startedAt,
            attempts: attempt,
            contextCount: input.contexts.length,
            status: 'error',
            errorKind: lastError.kind,
          });
          throw lastError;
        }
        await this.sleepFunction(
          this.options.retryBaseDelayMs * 2 ** (attempt - 1) +
            Math.floor(this.randomFunction() * this.options.retryBaseDelayMs),
        );
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError ?? new LlmProviderError('unavailable', false);
  }

  private mapStatus(status: number): LlmProviderError {
    if ([400, 404, 422].includes(status)) return new LlmProviderError('invalid_request', false);
    if (status === 401 || status === 403) return new LlmProviderError('authentication', false);
    if (status === 429) return new LlmProviderError('rate_limit', true);
    if (status === 408) return new LlmProviderError('timeout', true);
    if ([500, 502, 503, 504].includes(status)) return new LlmProviderError('unavailable', true);
    return new LlmProviderError('unavailable', false);
  }

  private generationConfig(): { maxOutputTokens: number; temperature?: number } {
    if (this.model === 'gemini-3.5-flash-lite') {
      return { maxOutputTokens: this.options.maxOutputTokens };
    }
    return {
      temperature: this.options.temperature,
      maxOutputTokens: this.options.maxOutputTokens,
    };
  }
}
