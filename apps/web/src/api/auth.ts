import { authSessionSchema, type AuthSession } from '@nexus-kb/contracts';
import { apiRequest } from './client';

export function fetchSession(): Promise<AuthSession> {
  return apiRequest('/v1/auth/session', authSessionSchema);
}
