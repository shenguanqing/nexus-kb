import type { Capability } from '@nexus-kb/contracts';

export type RouteAccessDecision = 'allow' | 'login' | 'forbidden';

export function decideRouteAccess(
  isAuthenticated: boolean,
  isAdmin: boolean,
  capabilities: readonly Capability[],
  requiredCapabilities: readonly Capability[],
  adminOnly = false,
): RouteAccessDecision {
  if (!isAuthenticated) return 'login';
  if (adminOnly && !isAdmin) return 'forbidden';
  return requiredCapabilities.every((capability) => capabilities.includes(capability))
    ? 'allow'
    : 'forbidden';
}
