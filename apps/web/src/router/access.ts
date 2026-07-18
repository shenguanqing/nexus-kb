import type { Capability } from '@nexus-kb/contracts';

export type RouteAccessDecision = 'allow' | 'login' | 'forbidden';

export function decideRouteAccess(
  isAuthenticated: boolean,
  capabilities: readonly Capability[],
  requiredCapabilities: readonly Capability[],
): RouteAccessDecision {
  if (!isAuthenticated) return 'login';
  return requiredCapabilities.every((capability) => capabilities.includes(capability))
    ? 'allow'
    : 'forbidden';
}
