import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticationGuard } from '../src/auth/authentication.guard';
import type { AuthenticatedRequest, Identity } from '../src/auth/identity';
import type { TokenVerifier } from '../src/auth/token-verifier';
import { ApiException } from '../src/common/api-exception';
import type { AppConfig } from '../src/config/app-config';

const verifiedIdentity: Identity = {
  tenantId: 'verified-tenant',
  userId: 'verified-user',
  department: 'finance',
  roles: ['user'],
  allowedSensitivities: ['public', 'internal'],
  capabilities: ['documents:read'],
  defaultSensitivity: 'internal',
};

function executionContext(request: AuthenticatedRequest): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function config(values: Partial<AppConfig['values']>): AppConfig {
  return {
    values: {
      NODE_ENV: 'test',
      AUTH_REQUIRED: false,
      DEV_TENANT_ID: 'test-tenant',
      DEV_USER_ID: 'test-user',
      DEV_DEPARTMENT: 'test-department',
      DEV_ROLES_JSON: ['user'],
      DEV_ALLOWED_SENSITIVITIES_JSON: ['public', 'internal'],
      DEV_CAPABILITIES_JSON: ['documents:read'],
      DEV_SENSITIVITY: 'internal',
      ...values,
    },
  } as unknown as AppConfig;
}

describe('AuthenticationGuard', () => {
  it('uses fixed identity only in development or test when authentication is disabled', async () => {
    const request = { headers: {} } as AuthenticatedRequest;
    const verify = vi.fn();
    const verifier = { verify } as unknown as TokenVerifier;
    const reflector = { getAllAndOverride: () => false } as unknown as Reflector;

    await expect(
      new AuthenticationGuard(config({}), reflector, verifier).canActivate(
        executionContext(request),
      ),
    ).resolves.toBe(true);
    expect(request.identity).toMatchObject({
      tenantId: 'test-tenant',
      userId: 'test-user',
      department: 'test-department',
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it('never falls back to development identity when authentication is required', async () => {
    const request = { headers: {} } as AuthenticatedRequest;
    const verifier = { verify: vi.fn() } as unknown as TokenVerifier;
    const reflector = { getAllAndOverride: () => false } as unknown as Reflector;

    await expect(
      new AuthenticationGuard(config({ AUTH_REQUIRED: true }), reflector, verifier).canActivate(
        executionContext(request),
      ),
    ).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
      status: 401,
    });
    expect(request.identity).toBeUndefined();
  });

  it('uses only a validated password session when password authentication is enabled', async () => {
    const request = { headers: { cookie: 'nexuskb_session=opaque-token' } } as AuthenticatedRequest;
    const identityFromCookie = vi.fn().mockResolvedValue(verifiedIdentity);
    const reflector = { getAllAndOverride: () => false } as unknown as Reflector;

    await expect(
      new AuthenticationGuard(
        config({ AUTH_REQUIRED: true, PASSWORD_AUTH_ENABLED: true }),
        reflector,
        { verify: vi.fn() },
        undefined,
        { identityFromCookie } as never,
      ).canActivate(executionContext(request)),
    ).resolves.toBe(true);
    expect(identityFromCookie).toHaveBeenCalledWith('nexuskb_session=opaque-token');
    expect(request.identity).toEqual(verifiedIdentity);
  });

  it('uses only the verified token identity and ignores spoofed request fields', async () => {
    const request = {
      headers: {
        authorization: 'Bearer signed.token.value',
        'x-tenant-id': 'spoofed-tenant',
        'x-role': 'admin',
      },
      body: {
        tenantId: 'spoofed-tenant',
        department: 'executive',
        roles: ['admin'],
      },
    } as unknown as AuthenticatedRequest;
    const verify = vi.fn().mockResolvedValue(verifiedIdentity);
    const reflector = { getAllAndOverride: () => false } as unknown as Reflector;

    await expect(
      new AuthenticationGuard(config({ AUTH_REQUIRED: true }), reflector, { verify }).canActivate(
        executionContext(request),
      ),
    ).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('signed.token.value');
    expect(request.identity).toEqual(verifiedIdentity);
  });

  it('preserves controlled identity-resolution errors after token verification', async () => {
    const request = {
      headers: { authorization: 'Bearer signed.token.value' },
    } as AuthenticatedRequest;
    const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
    const departmentPolicyError = new ApiException(
      'DEPARTMENT_POLICY_INVALID',
      '部门权限策略无有效敏感度',
      503,
    );

    await expect(
      new AuthenticationGuard(
        config({ AUTH_REQUIRED: true }),
        reflector,
        { verify: vi.fn().mockResolvedValue(verifiedIdentity) },
        { resolve: vi.fn().mockRejectedValue(departmentPolicyError) } as never,
      ).canActivate(executionContext(request)),
    ).rejects.toBe(departmentPolicyError);
  });

  it('allows explicitly public routes without parsing credentials', async () => {
    const request = { headers: {} } as AuthenticatedRequest;
    const verify = vi.fn();
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;

    await expect(
      new AuthenticationGuard(config({ AUTH_REQUIRED: true }), reflector, {
        verify,
      }).canActivate(executionContext(request)),
    ).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });
});
