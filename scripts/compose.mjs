import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { composeArguments } from './compose-arguments.mjs';
import { runProductionPreflight } from './production-preflight.mjs';

const mode = process.argv[2];
const forwardedArguments = process.argv.slice(3);
const environmentFile = mode === 'production' ? '.env.production' : '.env';
const arguments_ = composeArguments(
  mode,
  forwardedArguments,
  existsSync('config/runtime.env'),
  environmentFile,
);

if (!arguments_) {
  process.stderr.write(
    'Usage: node scripts/compose.mjs <base|dev|oidc|full|full-db|production> [docker compose arguments]\n',
  );
  process.exitCode = 2;
} else {
  const forwarded =
    forwardedArguments[0] === '--' ? forwardedArguments.slice(1) : forwardedArguments;
  const safeWithoutPreflight = new Set([
    'config',
    'down',
    'events',
    'images',
    'kill',
    'logs',
    'ps',
    'stop',
    'top',
    'version',
  ]);
  if (mode === 'production' && !safeWithoutPreflight.has(forwarded[0])) {
    runProductionPreflight({ environmentFile });
  }
  const result = spawnSync('docker', ['compose', ...arguments_], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
