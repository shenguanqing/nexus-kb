import { describe, expect, it, vi } from 'vitest';
import { AuthController } from '../src/auth/auth.controller';
import type { AuthenticatedRequest } from '../src/auth/identity';
import type { AppConfig } from '../src/config/app-config';

describe('AuthController', () => {
  it('records and returns only the authenticated server identity summary', async () => {
    const observe = vi.fn().mockResolvedValue(undefined);
    const controller = new AuthController(
      { values: { AUTH_REQUIRED: false } } as AppConfig,
      { observe } as never,
    );
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
    await expect(controller.getSession(request)).resolves.toEqual({
      authenticated: true,
      mode: 'development',
      identity: request.identity,
    });
    expect(observe).toHaveBeenCalledWith(request.identity);
  });
});
