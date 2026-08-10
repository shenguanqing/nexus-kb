import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../src/config/app-config';
import { CloudPolicyService } from '../src/ingestion/cloud-policy';

function config(
  allowConfidential: boolean,
  rules: Array<{
    sensitivity: 'public' | 'internal' | 'confidential';
    providerId: string;
    region: string;
    allowed: boolean;
  }> = [],
): AppConfig {
  return {
    values: {
      ALLOW_CONFIDENTIAL_TO_CLOUD: allowConfidential,
      CLOUD_EGRESS_RULES_JSON: rules,
    },
  } as unknown as AppConfig;
}

describe('CloudPolicyService', () => {
  it('blocks confidential content before a provider operation is invoked', async () => {
    const service = new CloudPolicyService(config(false));
    const providerCall = vi.fn().mockResolvedValue(['vector']);

    const result = await service.executeIfAllowed(
      { sensitivity: 'confidential', providerId: 'mock', region: 'cn' },
      providerCall,
    );

    expect(result.policy).toMatchObject({
      decision: 'blocked',
      reasonCode: 'CONFIDENTIAL_CLOUD_EGRESS_DENIED',
    });
    expect(providerCall).not.toHaveBeenCalled();
    expect(JSON.stringify(result.policy)).not.toContain('正文');
  });

  it('supports an explicit provider and region rule', () => {
    const service = new CloudPolicyService(
      config(false, [
        {
          sensitivity: 'confidential',
          providerId: 'approved-provider',
          region: 'cn-shanghai',
          allowed: true,
        },
      ]),
    );

    expect(
      service.evaluate({
        sensitivity: 'confidential',
        providerId: 'approved-provider',
        region: 'cn-shanghai',
      }),
    ).toMatchObject({ decision: 'allowed', reasonCode: 'EXPLICIT_RULE_ALLOWED' });
  });

  it('allows confidential content for the approved local Ollama provider', () => {
    const service = new CloudPolicyService(config(false));

    expect(
      service.evaluate({
        sensitivity: 'confidential',
        providerId: 'ollama',
        region: 'local',
      }),
    ).toMatchObject({ decision: 'allowed', reasonCode: 'LOCAL_MODEL_ALLOWED' });
  });

  it('lets an explicit block override the local provider default', () => {
    const service = new CloudPolicyService(
      config(false, [
        { sensitivity: 'confidential', providerId: 'ollama', region: 'local', allowed: false },
      ]),
    );

    expect(
      service.evaluate({ sensitivity: 'confidential', providerId: 'ollama', region: 'local' }),
    ).toMatchObject({
      decision: 'blocked',
      reasonCode: 'EXPLICIT_RULE_BLOCKED',
    });
  });
});
