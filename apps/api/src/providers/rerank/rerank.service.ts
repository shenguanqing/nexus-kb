import { Injectable, Optional } from '@nestjs/common';

import type { Identity } from '../../auth/identity';
import { KnowledgeContextPolicy } from '../../knowledge/knowledge-context-policy';
import type { RetrievedChunk } from '../../knowledge/retrieved-chunk';
import { OperationalLogger } from '../../common/operational-logger';
import { MetricsService } from '../../observability/metrics.service';
import { RerankProviderFactory } from './rerank-provider.factory';

@Injectable()
export class RerankService {
  constructor(
    private readonly factory: RerankProviderFactory,
    private readonly contextPolicy: KnowledgeContextPolicy,
    private readonly logger: OperationalLogger,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async rerank(input: {
    identity: Identity;
    query: string;
    chunks: RetrievedChunk[];
    topK: number;
    traceId: string;
  }): Promise<{ chunks: RetrievedChunk[]; degraded: boolean }> {
    const original = input.chunks.slice(0, input.topK);
    const provider = this.factory.getProvider();
    if (!provider) return { chunks: original, degraded: false };
    if (
      !this.contextPolicy.allAllowed(input.identity, input.chunks, 'rerank', {
        id: provider.id,
        region: provider.region,
      })
    ) {
      this.logDegradation(input, provider.id, provider.model, 'policy_denied');
      return { chunks: original, degraded: true };
    }
    try {
      return {
        chunks: await provider.rerank(input.query, input.chunks, input.topK),
        degraded: false,
      };
    } catch (error) {
      this.logDegradation(
        input,
        provider.id,
        provider.model,
        error instanceof Error ? error.name : 'unknown',
      );
      return { chunks: original, degraded: true };
    }
  }

  private logDegradation(
    input: { identity: Identity; traceId: string },
    provider: string,
    model: string,
    status: string,
  ): void {
    this.logger.warn('rerank_degraded_to_vector_order', {
      traceId: input.traceId,
      tenantId: input.identity.tenantId,
      userId: input.identity.userId,
      provider,
      model,
      status,
    });
    this.metrics?.observeRerankDegradation(status === 'policy_denied' ? status : 'provider_error');
  }
}
