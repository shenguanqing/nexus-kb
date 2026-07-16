import { Injectable } from '@nestjs/common';

import { CloudPolicyService } from '../../ingestion/cloud-policy';
import { EmbeddingProviderFactory } from './embedding-provider.factory';
import { ProviderError } from './provider-error';

interface EmbeddingPolicyContext {
  sensitivity: 'public' | 'internal' | 'confidential';
}

@Injectable()
export class EmbeddingService {
  constructor(
    private readonly factory: EmbeddingProviderFactory,
    private readonly cloudPolicy: CloudPolicyService,
  ) {}

  async embedDocuments(texts: string[], context: EmbeddingPolicyContext): Promise<number[][]> {
    const provider = this.factory.getProvider();
    const result = await this.cloudPolicy.executeIfAllowed(
      {
        sensitivity: context.sensitivity,
        providerId: provider.id,
        region: provider.region,
      },
      () => provider.embedDocuments(texts),
    );
    if (result.policy.decision === 'blocked') {
      throw new ProviderError('policy_denied', false);
    }
    if (!result.value) throw new ProviderError('invalid_response', false);
    return result.value;
  }

  async embedQuery(text: string, context: EmbeddingPolicyContext): Promise<number[]> {
    const provider = this.factory.getProvider();
    const result = await this.cloudPolicy.executeIfAllowed(
      {
        sensitivity: context.sensitivity,
        providerId: provider.id,
        region: provider.region,
      },
      () => provider.embedQuery(text),
    );
    if (result.policy.decision === 'blocked') {
      throw new ProviderError('policy_denied', false);
    }
    if (!result.value) throw new ProviderError('invalid_response', false);
    return result.value;
  }
}
