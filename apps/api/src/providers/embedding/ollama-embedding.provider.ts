import { z } from 'zod';

import {
  OpenAiCompatibleEmbeddingProvider,
  type OpenAiCompatibleEmbeddingOptions,
  type ParsedEmbeddingResponse,
} from './openai-compatible-embedding.provider';
import { ProviderError } from './provider-error';

const ollamaEmbeddingResponseSchema = z
  .object({
    model: z.string(),
    embeddings: z.array(z.array(z.number().finite())),
    total_duration: z.number().int().nonnegative().optional(),
    load_duration: z.number().int().nonnegative().optional(),
    prompt_eval_count: z.number().int().nonnegative().optional(),
  })
  .passthrough();

function parseOllamaResponse(body: unknown): ParsedEmbeddingResponse {
  const parsed = ollamaEmbeddingResponseSchema.safeParse(body);
  if (!parsed.success) throw new ProviderError('invalid_response', false);
  return {
    vectors: parsed.data.embeddings,
    model: parsed.data.model,
    promptTokens: parsed.data.prompt_eval_count,
    totalTokens: parsed.data.prompt_eval_count,
    providerDurationMs:
      parsed.data.total_duration === undefined ? undefined : parsed.data.total_duration / 1e6,
    loadDurationMs:
      parsed.data.load_duration === undefined ? undefined : parsed.data.load_duration / 1e6,
  };
}

export type OllamaEmbeddingOptions = Omit<
  OpenAiCompatibleEmbeddingOptions,
  'id' | 'apiKey' | 'endpointPath' | 'requestBody' | 'responseParser'
> & { keepAlive: string };

export class OllamaEmbeddingProvider extends OpenAiCompatibleEmbeddingProvider {
  constructor(options: OllamaEmbeddingOptions) {
    super({
      ...options,
      id: 'ollama',
      endpointPath: '/api/embed',
      requestBody: (texts) => ({
        model: options.model,
        input: texts,
        dimensions: options.dimensions,
        truncate: false,
        keep_alive: options.keepAlive,
      }),
      responseParser: parseOllamaResponse,
    });
  }
}
