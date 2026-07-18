import {
  providerStatusResponseSchema,
  systemStatusResponseSchema,
  type ProviderStatusResponse,
  type SystemStatusResponse,
} from '@nexus-kb/contracts';

import { apiRequest } from './client';

export function getProviderStatuses(): Promise<ProviderStatusResponse> {
  return apiRequest('/v1/system/providers', providerStatusResponseSchema);
}

export function getSystemStatus(): Promise<SystemStatusResponse> {
  return apiRequest('/v1/system/status', systemStatusResponseSchema);
}
