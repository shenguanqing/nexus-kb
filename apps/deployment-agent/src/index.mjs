import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { validatePayload } from './policy.mjs';

const executeFile = promisify(execFile);
const port = Number(process.env.DEPLOYMENT_AGENT_PORT ?? '8200');
const token = process.env.DEPLOYMENT_AGENT_TOKEN ?? '';
const workspace = process.env.DEPLOYMENT_WORKSPACE ?? '';
const workspaceReady = workspace.startsWith('/') && !workspace.includes('\0');
const runtimeEnvironmentPath = `${workspace}/config/runtime.env`;
const readinessUrls = {
  api: 'http://api:3000/health/ready',
  'parser-worker': 'http://parser-worker:8000/health/ready',
  'parser-worker-dwg': 'http://parser-worker-dwg:8000/health/ready',
  'reranker-worker': 'http://reranker-worker:8100/health/ready',
};
let activeDeploymentId = null;

function json(reply, status, payload) {
  reply.writeHead(status, { 'content-type': 'application/json' });
  reply.end(JSON.stringify(payload));
}

function authorized(request) {
  return token.length >= 32 && request.headers.authorization === `Bearer ${token}`;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function writeEnvironment(environment) {
  await mkdir(`${workspace}/config`, { recursive: true });
  const content = Object.entries(environment)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join('\n');
  const temporary = `${runtimeEnvironmentPath}.tmp`;
  await writeFile(temporary, `${content}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, runtimeEnvironmentPath);
}

async function recreate(services) {
  await executeFile(
    'docker',
    [
      'compose',
      '--project-directory',
      workspace,
      '-f',
      `${workspace}/compose.yaml`,
      '-f',
      `${workspace}/compose.dwg.yaml`,
      '--env-file',
      `${workspace}/.env`,
      '--env-file',
      runtimeEnvironmentPath,
      'up',
      '-d',
      '--force-recreate',
      '--no-deps',
      ...services,
    ],
    { timeout: 180_000, maxBuffer: 1024 * 1024 },
  );
}

async function waitForReadiness(services) {
  const deadline = Date.now() + 180_000;
  let successfulChecks = 0;
  while (Date.now() < deadline) {
    const checks = await Promise.all(
      services.map(async (service) => {
        try {
          const response = await fetch(readinessUrls[service], {
            signal: AbortSignal.timeout(5000),
          });
          return response.ok;
        } catch {
          return false;
        }
      }),
    );
    if (checks.every(Boolean)) {
      successfulChecks += 1;
      if (successfulChecks >= 2) return;
    } else {
      successfulChecks = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('READINESS_FAILED');
}

async function callback(url, result) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(result),
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) return;
    } catch {
      // The API can be temporarily unavailable while its container is recreated.
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function executeDeployment(payload) {
  let result = { status: 'failed', errorCode: 'DEPLOYMENT_FAILED' };
  try {
    await writeEnvironment(payload.environment);
    await recreate(payload.services);
    await waitForReadiness(payload.services);
    result = { status: 'succeeded', errorCode: null };
  } catch {
    try {
      await writeEnvironment(payload.previousEnvironment);
      await recreate(payload.services);
      await waitForReadiness(payload.services);
      result = { status: 'rolled_back', errorCode: 'READINESS_FAILED' };
    } catch {
      result = { status: 'failed', errorCode: 'ROLLBACK_FAILED' };
    }
  } finally {
    await callback(payload.callbackUrl, result);
    activeDeploymentId = null;
  }
}

const server = createServer(async (request, reply) => {
  if (request.method === 'GET' && request.url === '/health/live') {
    return json(reply, 200, { status: 'live' });
  }
  if (request.method === 'GET' && request.url === '/health/ready') {
    const ready = token.length >= 32 && workspaceReady;
    return json(reply, ready ? 200 : 503, {
      status: ready ? 'ready' : 'not_ready',
    });
  }
  if (request.method !== 'POST' || request.url !== '/v1/deployments') {
    return json(reply, 404, { error: 'NOT_FOUND' });
  }
  if (!authorized(request)) return json(reply, 401, { error: 'UNAUTHORIZED' });
  if (!workspaceReady) return json(reply, 503, { error: 'WORKSPACE_UNAVAILABLE' });
  if (activeDeploymentId) return json(reply, 409, { error: 'DEPLOYMENT_RUNNING' });
  try {
    const payload = validatePayload(await readBody(request));
    activeDeploymentId = payload.deploymentId;
    json(reply, 202, { accepted: true, deploymentId: payload.deploymentId });
    void executeDeployment(payload);
  } catch {
    return json(reply, 400, { error: 'INVALID_REQUEST' });
  }
});

server.listen(port, '0.0.0.0');
