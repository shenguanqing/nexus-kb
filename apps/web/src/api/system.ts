import {
  providerStatusResponseSchema,
  systemStatusResponseSchema,
  systemConfigurationResponseSchema,
  systemConfigurationVersionSchema,
  systemDeploymentAcceptedSchema,
  systemDeploymentListResponseSchema,
  systemDeploymentSchema,
  type ProviderStatusResponse,
  type SystemConfigurationResponse,
  type SystemConfigurationUpdateRequest,
  type SystemConfigurationVersion,
  type SystemDeployment,
  type SystemDeploymentAccepted,
  type SystemStatusResponse,
} from '@nexus-kb/contracts';

import { apiRequest } from './client';

export function getProviderStatuses(): Promise<ProviderStatusResponse> {
  return apiRequest('/v1/system/providers', providerStatusResponseSchema);
}

export function getSystemStatus(): Promise<SystemStatusResponse> {
  return apiRequest('/v1/system/status', systemStatusResponseSchema);
}

export function getSystemConfiguration(): Promise<SystemConfigurationResponse> {
  return apiRequest('/v1/system/configuration', systemConfigurationResponseSchema);
}

export function createSystemConfiguration(
  request: SystemConfigurationUpdateRequest,
): Promise<SystemConfigurationVersion> {
  return apiRequest('/v1/system/configurations', systemConfigurationVersionSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
}

export function deploySystemConfiguration(id: string): Promise<SystemDeploymentAccepted> {
  return apiRequest(
    `/v1/system/configurations/${encodeURIComponent(id)}/deploy`,
    systemDeploymentAcceptedSchema,
    {
      method: 'POST',
    },
  );
}

export function getSystemDeployments(): Promise<{ deployments: SystemDeployment[] }> {
  return apiRequest('/v1/system/deployments', systemDeploymentListResponseSchema);
}

export function getSystemDeployment(id: string): Promise<SystemDeployment> {
  return apiRequest(`/v1/system/deployments/${encodeURIComponent(id)}`, systemDeploymentSchema);
}

export function rollbackSystemDeployment(id: string): Promise<SystemDeploymentAccepted> {
  return apiRequest(
    `/v1/system/deployments/${encodeURIComponent(id)}/rollback`,
    systemDeploymentAcceptedSchema,
    {
      method: 'POST',
    },
  );
}
