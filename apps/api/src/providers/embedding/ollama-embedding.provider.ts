import {
  OpenAiCompatibleEmbeddingProvider,
  type OpenAiCompatibleEmbeddingOptions,
} from './openai-compatible-embedding.provider';

export type OllamaEmbeddingOptions = Omit<
  OpenAiCompatibleEmbeddingOptions,
  'id' | 'apiKey' | 'endpointPath'
>;

export class OllamaEmbeddingProvider extends OpenAiCompatibleEmbeddingProvider {
  constructor(options: OllamaEmbeddingOptions) {
    super({ ...options, id: 'ollama', endpointPath: '/v1/embeddings' });
  }
}
