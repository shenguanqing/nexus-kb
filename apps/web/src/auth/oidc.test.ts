import type { OidcBrowserLogin } from '@nexus-kb/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { completeOidcLogin, OidcLoginError } from './oidc';

const options: OidcBrowserLogin = {
  authorizationEndpoint: 'https://identity.example.test/authorize',
  tokenEndpoint: 'https://identity.example.test/token',
  clientId: 'nexus-kb-web',
  redirectUri: 'https://knowledge.example.test/auth/callback',
  scopes: ['openid', 'profile'],
};

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('OIDC PKCE callback', () => {
  it('exchanges a one-time authorization code and consumes the transaction', async () => {
    sessionStorage.setItem(
      'nexuskb.oidc.pkce',
      JSON.stringify({
        state: 's'.repeat(43),
        verifier: 'v'.repeat(43),
        returnTo: '/documents',
        createdAt: Date.now(),
      }),
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'token-value', token_type: 'Bearer' }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      completeOidcLogin(
        options,
        new URLSearchParams({ code: 'authorization-code', state: 's'.repeat(43) }),
      ),
    ).resolves.toEqual({ accessToken: 'token-value', returnTo: '/documents' });

    expect(sessionStorage.getItem('nexuskb.oidc.pkce')).toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(options.tokenEndpoint);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe('omit');
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(requestBody).toBeInstanceOf(URLSearchParams);
    if (!(requestBody instanceof URLSearchParams))
      throw new Error('Expected URL-encoded token request');
    expect(requestBody.toString()).toContain('code_verifier=');
  });

  it('rejects a callback whose state does not match and never redeems its code', async () => {
    sessionStorage.setItem(
      'nexuskb.oidc.pkce',
      JSON.stringify({
        state: 's'.repeat(43),
        verifier: 'v'.repeat(43),
        returnTo: '/ask',
        createdAt: Date.now(),
      }),
    );
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      completeOidcLogin(
        options,
        new URLSearchParams({ code: 'authorization-code', state: 'x'.repeat(43) }),
      ),
    ).rejects.toBeInstanceOf(OidcLoginError);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
