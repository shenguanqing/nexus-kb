import { describe, expect, it } from 'vitest';
import type { ProviderStatus } from '@nexus-kb/contracts';

import {
  credentialLabel,
  formatDiskUsage,
  formatDuration,
  providerTitle,
} from './system-presentation';

const disabledProvider: ProviderStatus = {
  kind: 'rerank',
  provider: null,
  model: null,
  configurationStatus: 'disabled',
  endpointHost: null,
  region: null,
  dimensions: null,
  credentialConfigured: false,
  fingerprint: null,
};

describe('system presentation', () => {
  it('labels local providers as not requiring a cloud credential', () => {
    expect(credentialLabel('ollama', false)).toBe('本地无需凭据');
    expect(credentialLabel('local_bge', false)).toBe('本地无需凭据');
  });

  it('presents disabled providers without inventing models', () => {
    expect(providerTitle(disabledProvider)).toBe('未启用');
  });

  it('formats measured values and preserves missing data', () => {
    expect(formatDiskUsage(0.251)).toBe('25.1%');
    expect(formatDiskUsage(null)).toBe('暂无数据');
    expect(formatDuration(125)).toBe('2 分 5 秒');
    expect(formatDuration(null)).toBe('暂无数据');
  });
});
