import { describe, expect, it } from 'vitest';
import { decideRouteAccess } from './access';

describe('decideRouteAccess', () => {
  it('distinguishes authentication from authorization', () => {
    expect(decideRouteAccess(false, [], [])).toBe('login');
    expect(decideRouteAccess(true, ['documents:read'], ['audit:read'])).toBe('forbidden');
    expect(decideRouteAccess(true, ['documents:read'], ['documents:read'])).toBe('allow');
  });
});
