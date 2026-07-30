import { z } from 'zod';

import {
  buildKnowledgePrompt,
  GENERAL_KNOWLEDGE_SYSTEM_PROMPT,
  KNOWLEDGE_SYSTEM_PROMPT,
} from './llm-prompt';
import type {
  LlmAnswer,
  LlmAnswerInput,
  LlmProvider,
  LlmProviderErrorKind,
  LlmTelemetryEvent,
} from './llm-provider';
import { LlmProviderError } from './llm-provider-error';

const responseSchema = z
  .object({
    id: z.string().optional(),
    model: z.string().optional(),
    choices: z.array(
      z.object({
        index: z.number().int().nonnegative(),
        message: z.object({ content: z.string().nullable() }).passthrough(),
      }),
    ),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative().optional(),
        completion_tokens: z.number().int().nonnegative().optional(),
        total_tokens: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export interface OpenAiCompatibleLlmOptions {
  id: string;
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

export class OpenAiCompatibleLlmProvider implements LlmProvider {
  readonly id: string;
  readonly model: string;
  readonly region: string;

  private readonly endpoint: string;
  private readonly fetchFunction: typeof fetch;
  private readonly sleepFunction: (durationMs: number) => Promise<void>;
  private readonly randomFunction: () => number;
  private readonly nowFunction: () => number;
  private readonly telemetryRecorder: (event: LlmTelemetryEvent) => void;

  constructor(private readonly options: OpenAiCompatibleLlmOptions) {
    this.id = options.id;
    this.model = options.model;
    this.region = options.region;
    this.endpoint = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    this.fetchFunction = options.fetchFunction ?? fetch;
    this.sleepFunction =
      options.sleepFunction ??
      ((durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)));
    this.randomFunction = options.randomFunction ?? Math.random;
    this.nowFunction = options.nowFunction ?? Date.now;
    this.telemetryRecorder = options.telemetryRecorder ?? (() => undefined);
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
            authorization: `Bearer ${this.options.apiKey}`,
            'content-type': 'application/json',
            'x-request-id': input.traceId,
          },
          body: JSON.stringify({
            model: this.model,
            temperature: this.options.temperature,
            max_tokens: this.options.maxOutputTokens,
            messages: [
              {
                role: 'system',
                content:
                  input.mode === 'general'
                    ? GENERAL_KNOWLEDGE_SYSTEM_PROMPT
                    : KNOWLEDGE_SYSTEM_PROMPT,
              },
              { role: 'user', content: buildKnowledgePrompt(input) },
            ],
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw this.mapStatus(response.status);
        let responseBody: unknown;
        try {
          responseBody = await response.json();
        } catch (error) {
          if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
            throw new LlmProviderError('timeout', true, { cause: error });
          }
          throw new LlmProviderError('invalid_response', false, { cause: error });
        }
        const parsed = responseSchema.safeParse(responseBody);
        if (!parsed.success || parsed.data.choices.length !== 1) {
          throw new LlmProviderError('invalid_response', false);
        }
        const text = parsed.data.choices[0]?.message.content?.trim();
        if (!text) throw new LlmProviderError('invalid_response', false);
        const result = {
          text,
          requestId: response.headers.get('x-request-id') ?? parsed.data.id,
          usage: {
            inputTokens: parsed.data.usage?.prompt_tokens,
            outputTokens: parsed.data.usage?.completion_tokens,
            totalTokens: parsed.data.usage?.total_tokens,
          },
        };
        this.telemetryRecorder({
          provider: this.id,
          model: this.model,
          region: this.region,
          requestId: result.requestId,
          durationMs: this.nowFunction() - startedAt,
          attempts: attempt,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
          contextCount: input.contexts.length,
          status: 'success',
        });
        return result;
      } catch (error) {
        lastError = this.normalizeError(error, controller.signal.aborted);
        if (!lastError.retryable || attempt === this.options.maxAttempts) {
          this.recordFailure(startedAt, attempt, input.contexts.length, lastError.kind);
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

  private normalizeError(error: unknown, wasAborted: boolean): LlmProviderError {
    if (error instanceof LlmProviderError) return error;
    if (wasAborted || (error instanceof Error && error.name === 'AbortError')) {
      return new LlmProviderError('timeout', true, { cause: error });
    }
    return new LlmProviderError('unavailable', true, { cause: error });
  }

  private recordFailure(
    startedAt: number,
    attempts: number,
    contextCount: number,
    errorKind: LlmProviderErrorKind,
  ): void {
    this.telemetryRecorder({
      provider: this.id,
      model: this.model,
      region: this.region,
      durationMs: this.nowFunction() - startedAt,
      attempts,
      contextCount,
      status: 'error',
      errorKind,
    });
  }
}
