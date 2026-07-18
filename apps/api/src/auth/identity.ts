import type { FastifyRequest } from 'fastify';

import { ApiException } from '../common/api-exception';
import type { AppConfig } from '../config/app-config';

export const SENSITIVITIES = ['public', 'internal', 'confidential'] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export const CAPABILITIES = [
  'documents:read',
  'documents:write',
  'documents:delete',
  'audit:read',
  'system:read',
  'access:read',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export interface Identity {
  tenantId: string;
  userId: string;
  department: string;
  roles: string[];
  allowedSensitivities: Sensitivity[];
  capabilities: Capability[];
  defaultSensitivity: Sensitivity;
}

export interface AuthenticatedRequest extends FastifyRequest {
  identity?: Identity;
}

export function developmentIdentity(config: AppConfig): Identity {
  return {
    tenantId: config.values.DEV_TENANT_ID,
    userId: config.values.DEV_USER_ID,
    department: config.values.DEV_DEPARTMENT,
    roles: [...config.values.DEV_ROLES_JSON],
    allowedSensitivities: [...new Set(config.values.DEV_ALLOWED_SENSITIVITIES_JSON)],
    capabilities: [...new Set(config.values.DEV_CAPABILITIES_JSON)],
    defaultSensitivity: config.values.DEV_SENSITIVITY,
  };
}

export function requestIdentity(request: FastifyRequest): Identity {
  const identity = (request as AuthenticatedRequest).identity;
  if (!identity) throw new ApiException('AUTHENTICATION_REQUIRED', '需要身份认证', 401);
  return identity;
}
