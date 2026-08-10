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
      {} as never,
    );
    const request = {
      identity: {
        tenantId: 'tenant-a',
        userId: 'user-a',
        department: 'finance',
        roles: ['user'],
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

  it('returns the enabled public login method without account details', () => {
    const controller = new AuthController(
      { values: { AUTH_REQUIRED: true, PASSWORD_AUTH_ENABLED: true } } as AppConfig,
      {} as never,
      {} as never,
    );
    expect(controller.loginOptions()).toEqual({ mode: 'password', passwordEnabled: true });
  });

  it('creates a password session cookie only after the server accepts credentials', async () => {
    const identity = {
      tenantId: 'tenant-a',
      userId: 'user-a',
      department: 'finance',
      roles: ['user'],
      allowedSensitivities: ['public', 'internal'],
      capabilities: ['documents:read'],
      defaultSensitivity: 'internal',
    } as const;
    const login = vi
      .fn()
      .mockResolvedValue({ identity, token: 'x'.repeat(43), expiresAt: new Date() });
    const sessionCookie = vi.fn().mockReturnValue('nexuskb_session=masked; HttpOnly');
    const observe = vi.fn().mockResolvedValue(undefined);
    const resolve = vi.fn().mockResolvedValue(identity);
    const controller = new AuthController(
      { values: { AUTH_REQUIRED: true, PASSWORD_AUTH_ENABLED: true } } as AppConfig,
      { observe, resolve } as never,
      { login, sessionCookie } as never,
    );
    const reply = { header: vi.fn() } as never;
    await expect(
      controller.loginWithPassword(
        { username: 'user-a', password: 'password-for-test' },
        { ip: '127.0.0.1' } as never,
        reply,
      ),
    ).resolves.toMatchObject({
      authenticated: true,
      mode: 'password',
      identity,
    });
    expect(login).toHaveBeenCalledWith('user-a', 'password-for-test', '127.0.0.1');
    expect(sessionCookie).toHaveBeenCalledWith('x'.repeat(43));
    expect(observe).toHaveBeenCalledWith(identity);
  });
});
