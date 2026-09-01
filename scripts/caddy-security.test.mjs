import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const caddyfile = await readFile(new URL('../Caddyfile', import.meta.url), 'utf8');
const productionCaddyfile = await readFile(
  new URL('../apps/web/Caddyfile.production', import.meta.url),
  'utf8',
);
const webIndex = await readFile(new URL('../apps/web/index.html', import.meta.url), 'utf8');

test('allows only same-origin document preview frames', () => {
  assert.match(caddyfile, /^\s*X-Frame-Options SAMEORIGIN\s*$/m);
  assert.match(caddyfile, /^\s*\+Content-Security-Policy "frame-ancestors 'self'"\s*$/m);
  assert.doesNotMatch(caddyfile, /^\s*X-Frame-Options DENY\s*$/m);
});

test('terminates production TLS with strict transport and content security headers', () => {
  assert.match(
    productionCaddyfile,
    /^\s*tls \/run\/secrets\/tls_certificate \/run\/secrets\/tls_key\s*$/m,
  );
  assert.match(productionCaddyfile, /Strict-Transport-Security/);
  assert.match(productionCaddyfile, /frame-ancestors 'self'/);
  assert.match(productionCaddyfile, /object-src 'none'/);
  assert.match(productionCaddyfile, /@wrong_host not host \{\$NEXUS_KB_PUBLIC_HOST\}/);
  assert.doesNotMatch(productionCaddyfile, /\/metrics/);
});

test('keeps production scripts compatible with the self-only CSP', () => {
  assert.match(productionCaddyfile, /script-src 'self'/);
  assert.match(webIndex, /<script src="\/theme-bootstrap\.js"><\/script>/);
  assert.doesNotMatch(webIndex, /<script>\s*[\s\S]*?<\/script>/);
});
