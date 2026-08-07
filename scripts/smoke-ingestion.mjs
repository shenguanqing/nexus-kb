import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseUrl = (process.env.NEXUSKB_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const username = process.env.NEXUSKB_SMOKE_USERNAME;
const password = process.env.NEXUSKB_SMOKE_PASSWORD;
const enabled = process.env.NEXUSKB_ALLOW_LIVE_SMOKE === 'true';
const timeoutMs = Number(process.env.NEXUSKB_SMOKE_TIMEOUT_MS ?? 180_000);
const pollMs = 1_000;
const fixtures = [
  { file: 'parser-sample.pdf', mimeType: 'application/pdf' },
  { file: 'parser-sample.png', mimeType: 'image/png' },
];

if (!enabled || !username || !password) {
  console.error(
    'Refusing live ingestion smoke test. Set NEXUSKB_ALLOW_LIVE_SMOKE=true and provide NEXUSKB_SMOKE_USERNAME/NEXUSKB_SMOKE_PASSWORD.',
  );
  process.exitCode = 2;
} else {
  await run();
}

async function run() {
  let cookie;
  const documentIds = [];
  try {
    const login = await request('/v1/auth/password/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    cookie = cookieFrom(login);
    if (!cookie) throw new Error('Login did not return a session cookie.');

    for (const fixture of fixtures) {
      const file = await readFile(resolve('apps/parser-worker/tests/fixtures', fixture.file));
      const form = new FormData();
      form.append('file', new Blob([file], { type: fixture.mimeType }), fixture.file);
      const uploaded = await request('/v1/documents', {
        method: 'POST',
        headers: { cookie },
        body: form,
      });
      const payload = await json(uploaded);
      if (!isUploadAccepted(payload)) throw new Error(`Upload response for ${fixture.file} is invalid.`);
      documentIds.push(payload.documentId);
      await waitForCompletion(payload.jobId, cookie);
      await verifyIndexedDocument(payload.documentId, cookie);
      console.log(`${fixture.file}: indexed`);
    }
    console.log('Live PDF and image ingestion smoke test passed.');
  } finally {
    await Promise.allSettled(
      documentIds.map(async (documentId) => {
        if (!cookie) return;
        const response = await request(`/v1/documents/${documentId}`, {
          method: 'DELETE',
          headers: { cookie },
        });
        if (!response.ok) throw new Error('Cleanup failed.');
      }),
    );
    if (cookie) await request('/v1/auth/logout', { method: 'POST', headers: { cookie } });
  }
}

async function waitForCompletion(jobId, cookie) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await request(`/v1/ingestion-jobs/${jobId}`, { headers: { cookie } });
    const job = await json(response);
    if (job?.status === 'completed') return;
    if (job?.status === 'failed') throw new Error('Ingestion job failed. Inspect the authorized job detail.');
    await new Promise((resolveWait) => setTimeout(resolveWait, pollMs));
  }
  throw new Error(`Ingestion job did not finish within ${timeoutMs}ms.`);
}

async function verifyIndexedDocument(documentId, cookie) {
  const response = await request(`/v1/documents/${documentId}`, { headers: { cookie } });
  const document = await json(response);
  if (document?.status !== 'active' || !document.activeVersion) {
    throw new Error('Document was not activated after ingestion.');
  }
  const version = document.versions?.find((entry) => entry.version === document.activeVersion);
  if (!version?.vectorCollection || !version.indexedAt || version.chunkCount < 1) {
    throw new Error('Document activation does not contain indexed chunks.');
  }
}

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (!response.ok) throw new Error(`Request failed: ${init?.method ?? 'GET'} ${path} (${response.status}).`);
  return response;
}

async function json(response) {
  return response.json();
}

function cookieFrom(response) {
  const value = response.headers.get('set-cookie');
  return value?.split(';', 1)[0];
}

function isUploadAccepted(value) {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.documentId === 'string' &&
    typeof value.jobId === 'string'
  );
}
