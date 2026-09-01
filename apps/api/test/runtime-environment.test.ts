import { describe, expect, it } from 'vitest';

import {
  runtimeEnvironmentSha256,
  serializeRuntimeEnvironment,
} from '../src/system/runtime-environment';

describe('runtime environment serialization', () => {
  it('sorts keys, quotes values and produces a stable hash', () => {
    const left = { Z_VALUE: 'line safe', A_VALUE: 'contains spaces' };
    const right = { A_VALUE: 'contains spaces', Z_VALUE: 'line safe' };
    expect(serializeRuntimeEnvironment(left)).toBe(
      'A_VALUE="contains spaces"\nZ_VALUE="line safe"\n',
    );
    expect(runtimeEnvironmentSha256(left)).toBe(runtimeEnvironmentSha256(right));
  });
});
