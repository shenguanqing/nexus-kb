import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';

import { OidcJwtTokenVerifier } from '../src/auth/oidc-jwt-token.verifier';
import type { JwtVerifyFunction } from '../src/auth/oidc-jwt-token.verifier';
import type { AppConfig } from '../src/config/app-config';

function config(): AppConfig {
  return {
    values: {
      OIDC_ISSUER: 'https://identity.example.test',
      OIDC_AUDIENCE: 'nexus-kb',
      OIDC_JWKS_URI: 'https://identity.example.test/.well-known/jwks.json',
      OIDC_ALLOWED_ALGORITHMS_JSON: ['RS256'],
      OIDC_CLOCK_TOLERANCE_SECONDS: 5,
      OIDC_JWKS_TIMEOUT_MS: 5000,
    },
  } as unknown as AppConfig;
}

describe('OidcJwtTokenVerifier', () => {
  it('accepts a correctly signed JWT and rejects a token signed by an unknown key', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = 'trusted-key';
    publicJwk.alg = 'RS256';
    const localJwks = createLocalJWKSet({ keys: [publicJwk] });
    const verifyFunction: JwtVerifyFunction = (token) =>
      jwtVerify(token, localJwks, {
        issuer: 'https://identity.example.test',
        audience: 'nexus-kb',
        algorithms: ['RS256'],
      });
    const token = await new SignJWT({
      tenantId: 'tenant-a',
      department: 'finance',
      roles: [],
      allowedSensitivities: ['public', 'internal'],
      capabilities: ['documents:read'],
      defaultSensitivity: 'internal',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'trusted-key' })
      .setSubject('user-a')
      .setIssuer('https://identity.example.test')
      .setAudience('nexus-kb')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    const verifier = new OidcJwtTokenVerifier(config(), verifyFunction);

    await expect(verifier.verify(token)).resolves.toMatchObject({
      tenantId: 'tenant-a',
      userId: 'user-a',
    });

    const untrustedKeys = await generateKeyPair('RS256');
    const untrusted = await new SignJWT({
      tenantId: 'tenant-a',
      department: 'finance',
      roles: [],
      allowedSensitivities: ['public'],
      capabilities: ['documents:read'],
      defaultSensitivity: 'public',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'unknown-key' })
      .setSubject('user-a')
      .setIssuer('https://identity.example.test')
      .setAudience('nexus-kb')
      .setExpirationTime('5m')
      .sign(untrustedKeys.privateKey);
    await expect(verifier.verify(untrusted)).rejects.toMatchObject({
      name: 'TokenVerificationError',
    });

    const expired = await new SignJWT({
      tenantId: 'tenant-a',
      department: 'finance',
      roles: [],
      allowedSensitivities: ['public'],
      capabilities: ['documents:read'],
      defaultSensitivity: 'public',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'trusted-key' })
      .setSubject('user-a')
      .setIssuer('https://identity.example.test')
      .setAudience('nexus-kb')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(privateKey);
    await expect(verifier.verify(expired)).rejects.toMatchObject({
      name: 'TokenVerificationError',
    });
  });

  it('maps only signature-verified and runtime-validated claims into Identity', async () => {
    const verifyFunction = vi.fn<JwtVerifyFunction>().mockResolvedValue({
      payload: {
        sub: 'user-a',
        tenantId: 'tenant-a',
        department: 'finance',
        roles: ['document_admin', 'document_admin'],
        allowedSensitivities: ['public', 'internal'],
        capabilities: ['documents:read', 'documents:delete'],
        defaultSensitivity: 'internal',
      },
      protectedHeader: { alg: 'RS256' },
    });
    const verifier = new OidcJwtTokenVerifier(config(), verifyFunction);

    await expect(verifier.verify('signed-token')).resolves.toEqual({
      tenantId: 'tenant-a',
      userId: 'user-a',
      department: 'finance',
      roles: ['document_admin'],
      allowedSensitivities: ['public', 'internal'],
      capabilities: ['documents:read', 'documents:delete'],
      defaultSensitivity: 'internal',
    });
    expect(verifyFunction).toHaveBeenCalledWith('signed-token');
  });

  it('fails closed when required business claims are missing or inconsistent', async () => {
    const verifyFunction = vi.fn<JwtVerifyFunction>().mockResolvedValue({
      payload: {
        sub: 'user-a',
        tenantId: 'tenant-a',
        department: 'finance',
        roles: [],
        allowedSensitivities: ['public'],
        capabilities: ['documents:read'],
        defaultSensitivity: 'internal',
      },
      protectedHeader: { alg: 'RS256' },
    });

    await expect(
      new OidcJwtTokenVerifier(config(), verifyFunction).verify('signed-token'),
    ).rejects.toMatchObject({ name: 'TokenVerificationError' });
  });
});
