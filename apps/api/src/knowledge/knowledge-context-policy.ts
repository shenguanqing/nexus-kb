import { Injectable } from '@nestjs/common';

import { AclPolicy } from '../auth/acl-policy';
import type { Identity } from '../auth/identity';
import { CloudPolicyService } from '../ingestion/cloud-policy';
import type { RetrievedChunk } from './retrieved-chunk';

export type KnowledgeContextStage = 'rerank' | 'llm' | 'citation';

@Injectable()
export class KnowledgeContextPolicy {
  constructor(
    private readonly acl: AclPolicy,
    private readonly cloudPolicy: CloudPolicyService,
  ) {}

  canUse(
    identity: Identity,
    chunk: RetrievedChunk,
    stage: KnowledgeContextStage,
    provider?: { id: string; region: string },
  ): boolean {
    if (!this.acl.canAccessChunk(identity, chunk.metadata)) return false;
    if (stage === 'citation') return true;
    if (!provider) return false;
    return (
      this.cloudPolicy.evaluate({
        sensitivity: chunk.metadata.sensitivity,
        providerId: provider.id,
        region: provider.region,
      }).decision === 'allowed'
    );
  }

  allAllowed(
    identity: Identity,
    chunks: RetrievedChunk[],
    stage: KnowledgeContextStage,
    provider?: { id: string; region: string },
  ): boolean {
    if (stage !== 'citation' && !this.canSendQuestion(identity, provider)) {
      return false;
    }
    return (
      chunks.length > 0 && chunks.every((chunk) => this.canUse(identity, chunk, stage, provider))
    );
  }

  canSendQuestion(identity: Identity, provider?: { id: string; region: string }): boolean {
    return (
      provider !== undefined &&
      this.cloudPolicy.evaluate({
        sensitivity: identity.defaultSensitivity,
        providerId: provider.id,
        region: provider.region,
      }).decision === 'allowed'
    );
  }
}
