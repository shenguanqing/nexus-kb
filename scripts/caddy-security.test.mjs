import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const caddyfile = await readFile(new URL('../Caddyfile', import.meta.url), 'utf8');

test('allows only same-origin document preview frames', () => {
  assert.match(caddyfile, /^\s*X-Frame-Options SAMEORIGIN\s*$/m);
  assert.match(caddyfile, /^\s*\+Content-Security-Policy "frame-ancestors 'self'"\s*$/m);
  assert.doesNotMatch(caddyfile, /^\s*X-Frame-Options DENY\s*$/m);
});
