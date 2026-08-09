import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { composeArguments } from './compose-arguments.mjs';

const mode = process.argv[2];
const arguments_ = composeArguments(mode, process.argv.slice(3), existsSync('config/runtime.env'));

if (!arguments_) {
  process.stderr.write(
    'Usage: node scripts/compose.mjs <base|dev|full|full-db> [docker compose arguments]\n',
  );
  process.exitCode = 2;
} else {
  const result = spawnSync('docker', ['compose', ...arguments_], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
