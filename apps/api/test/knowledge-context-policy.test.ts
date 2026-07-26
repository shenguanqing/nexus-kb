import { describe, expect, it } from 'vitest';

import { AclPolicy } from '../src/auth/acl-policy';
import type { Identity } from '../src/auth/identity';
import type { AppConfig } from '../src/config/app-config';
import { CloudPolicyService } from '../src/ingestion/cloud-policy';
import { KnowledgeContextPolicy } from '../src/knowledge/knowledge-context-policy';
import type { RetrievedChunk } from '../src/knowledge/retrieved-chunk';

const identity: Identity = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  department: 'finance',
  roles: ['user'],
  allowedSensitivities: ['public', 'internal', 'confidential'],
  capabilities: ['documents:read'],
  defaultSensitivity: 'internal',
};

function policy(allowConfidential = false) {
  const config = {
    values: {
      ALLOW_CONFIDENTIAL_TO_CLOUD: allowConfidential,
      CLOUD_EGRESS_RULES_JSON: [],
    },
  } as unknown as AppConfig;
  return new KnowledgeContextPolicy(new AclPolicy(), new CloudPolicyService(config));
}

function chunk(overrides: Partial<RetrievedChunk['metadata']> = {}): RetrievedChunk {
  return {
    id: 'chunk-a',
    text: 'redacted text',
    distance: 0.1,
    metadata: {
      tenantId: 'tenant-a',
      documentId: 'document-a',
      documentVersion: 1,
      chunkId: 'chunk-a',
      sourceName: 'a.md',
      department: 'finance',
      sensitivity: 'internal',
      ownerId: 'owner-a',
      ...overrides,
    },
  };
}

describe('KnowledgeContextPolicy', () => {
  it('rechecks tenant, department and owner before rerank, LLM and citations', () => {
    const instance = policy();
    const crossTenant = chunk({ tenantId: 'tenant-b' });
    const otherDepartment = chunk({ department: 'legal', ownerId: 'user-b' });
    for (const stage of ['rerank', 'llm', 'citation'] as const) {
      expect(instance.canUse(identity, crossTenant, stage, { id: 'alibaba', region: 'cn' })).toBe(
        false,
      );
      expect(
        instance.canUse(identity, otherDepartment, stage, { id: 'alibaba', region: 'cn' }),
      ).toBe(false);
    }
  });

  it('blocks confidential cloud egress while still allowing an authorized citation', () => {
    const instance = policy();
    const confidential = chunk({ sensitivity: 'confidential' });
    expect(
      instance.canUse(identity, confidential, 'llm', { id: 'deepseek', region: 'global' }),
    ).toBe(false);
    expect(instance.canUse(identity, confidential, 'citation')).toBe(true);
  });

  it('also applies cloud policy to the question sensitivity before Rerank or LLM', () => {
    const confidentialQuestionIdentity = {
      ...identity,
      defaultSensitivity: 'confidential' as const,
    };
    const publicChunk = chunk({ sensitivity: 'public' });

    expect(
      policy().allAllowed(confidentialQuestionIdentity, [publicChunk], 'rerank', {
        id: 'alibaba',
        region: 'cn-beijing',
      }),
    ).toBe(false);
    expect(
      policy().allAllowed(confidentialQuestionIdentity, [publicChunk], 'llm', {
        id: 'deepseek',
        region: 'global',
      }),
    ).toBe(false);
  });
});
