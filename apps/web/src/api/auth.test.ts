import { afterEach, describe, expect, it, vi } from 'vitest';

import { loginWithPassword, logout } from './auth';

afterEach(() => vi.restoreAllMocks());

describe('password authentication API', () => {
  it('sends credentials only to the password-login endpoint and includes session cookies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          authenticated: true,
          mode: 'password',
          identity: {
            tenantId: 'tenant-a',
            userId: 'admin-a',
            department: 'platform',
            roles: ['platform_admin'],
            allowedSensitivities: ['public', 'internal'],
            capabilities: ['documents:read'],
            defaultSensitivity: 'internal',
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await loginWithPassword({ username: 'admin-a', password: 'safe-password' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/auth/password/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ username: 'admin-a', password: 'safe-password' }),
      }),
    );
  });

  it('revokes the server-side password session through the logout endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ loggedOut: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(logout()).resolves.toEqual({ loggedOut: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });
});
