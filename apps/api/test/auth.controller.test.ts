import { describe, expect, it } from 'vitest';
import { AuthController } from '../src/auth/auth.controller';
import type { AuthenticatedRequest } from '../src/auth/identity';
import type { AppConfig } from '../src/config/app-config';

describe('AuthController', () => {
  it('returns only the authenticated server identity summary', () => {
    const controller = new AuthController({ values: { AUTH_REQUIRED: false } } as AppConfig);
    const request = {
      identity: {
        tenantId: 'tenant-a',
        userId: 'user-a',
        department: 'finance',
        roles: [],
        allowedSensitivities: ['public', 'internal'],
        capabilities: ['documents:read'],
        defaultSensitivity: 'internal',
      },
    } as unknown as AuthenticatedRequest;
    expect(controller.getSession(request)).toEqual({
      authenticated: true,
      mode: 'development',
      identity: request.identity,
    });
  });
});
