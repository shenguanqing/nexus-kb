import { Injectable } from '@nestjs/common';

import { AppConfig } from '../config/app-config';

type Sensitivity = 'public' | 'internal' | 'confidential';

export interface CloudPolicyContext {
  sensitivity: Sensitivity;
  providerId?: string;
  region?: string;
}

export interface CloudPolicyResult {
  decision: 'allowed' | 'blocked';
  reasonCode: string;
  providerId: string | null;
  region: string | null;
}

@Injectable()
export class CloudPolicyService {
  constructor(private readonly config: AppConfig) {}

  evaluate(context: CloudPolicyContext): CloudPolicyResult {
    const providerId = context.providerId ?? null;
    const region = context.region ?? null;
    const explicitRule = this.config.values.CLOUD_EGRESS_RULES_JSON.find(
      (rule) =>
        rule.sensitivity === context.sensitivity &&
        rule.providerId === providerId &&
        rule.region === region,
    );
    if (explicitRule) {
      return {
        decision: explicitRule.allowed ? 'allowed' : 'blocked',
        reasonCode: explicitRule.allowed ? 'EXPLICIT_RULE_ALLOWED' : 'EXPLICIT_RULE_BLOCKED',
        providerId,
        region,
      };
    }
    if (providerId === 'ollama' && region === 'local') {
      return {
        decision: 'allowed',
        reasonCode: 'LOCAL_MODEL_ALLOWED',
        providerId,
        region,
      };
    }
    if (context.sensitivity === 'confidential' && !this.config.values.ALLOW_CONFIDENTIAL_TO_CLOUD) {
      return {
        decision: 'blocked',
        reasonCode: 'CONFIDENTIAL_CLOUD_EGRESS_DENIED',
        providerId,
        region,
      };
    }
    return {
      decision: 'allowed',
      reasonCode: 'DEFAULT_POLICY_ALLOWED',
      providerId,
      region,
    };
  }

  async executeIfAllowed<T>(
    context: CloudPolicyContext,
    operation: () => Promise<T>,
  ): Promise<{ policy: CloudPolicyResult; value?: T }> {
    const policy = this.evaluate(context);
    if (policy.decision === 'blocked') return { policy };
    return { policy, value: await operation() };
  }
}
