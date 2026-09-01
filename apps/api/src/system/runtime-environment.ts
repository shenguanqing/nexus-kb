import { createHash } from 'node:crypto';

export type RuntimeEnvironment = Record<string, string>;

export function serializeRuntimeEnvironment(environment: RuntimeEnvironment): string {
  const content = Object.entries(environment)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join('\n');
  return `${content}\n`;
}

export function runtimeEnvironmentSha256(environment: RuntimeEnvironment): string {
  return createHash('sha256').update(serializeRuntimeEnvironment(environment)).digest('hex');
}
