import {
  authLoginOptionsSchema,
  authLogoutResponseSchema,
  authSessionSchema,
  type AuthLoginOptions,
  type AuthSession,
  type PasswordLoginRequest,
} from '@nexus-kb/contracts';
import { apiRequest } from './client';

export function fetchSession(): Promise<AuthSession> {
  return apiRequest('/v1/auth/session', authSessionSchema);
}

export function fetchLoginOptions(): Promise<AuthLoginOptions> {
  return apiRequest('/v1/auth/login-options', authLoginOptionsSchema);
}

export function loginWithPassword(payload: PasswordLoginRequest): Promise<AuthSession> {
  return apiRequest('/v1/auth/password/login', authSessionSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function logout(): Promise<{ loggedOut: true }> {
  return apiRequest('/v1/auth/logout', authLogoutResponseSchema, { method: 'POST' });
}
