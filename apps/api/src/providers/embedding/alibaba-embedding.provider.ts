import {
  OpenAiCompatibleEmbeddingProvider,
  type OpenAiCompatibleEmbeddingOptions,
} from './openai-compatible-embedding.provider';

export interface AlibabaEmbeddingOptions extends Omit<
  OpenAiCompatibleEmbeddingOptions,
  'id' | 'endpointPath'
> {
  apiKey: string;
}

export class AlibabaEmbeddingProvider extends OpenAiCompatibleEmbeddingProvider {
  constructor(options: AlibabaEmbeddingOptions) {
    super({ ...options, id: 'alibaba', endpointPath: '/embeddings' });
  }
}
