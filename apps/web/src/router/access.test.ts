import { describe, expect, it } from 'vitest';
import { decideRouteAccess } from './access';

describe('decideRouteAccess', () => {
  it('distinguishes authentication from authorization', () => {
    expect(decideRouteAccess(false, false, [], [])).toBe('login');
    expect(decideRouteAccess(true, true, ['documents:read'], ['audit:read'])).toBe('forbidden');
    expect(decideRouteAccess(true, true, ['documents:read'], ['documents:read'], true)).toBe(
      'allow',
    );
    expect(decideRouteAccess(true, false, ['documents:read'], ['documents:read'], true)).toBe(
      'forbidden',
    );
  });
});
