import { spawnSync } from 'node:child_process';

const mode = process.argv[2];
const modes = {
  base: [],
  dev: ['--profile', 'configuration'],
  full: ['-f', 'compose.yaml', '-f', 'compose.dwg.yaml', '--profile', 'configuration'],
  'full-db': [
    '-f',
    'compose.yaml',
    '-f',
    'compose.dwg.yaml',
    '-f',
    'compose.db-gui.yaml',
    '--profile',
    'configuration',
  ],
};

if (!Object.hasOwn(modes, mode)) {
  process.stderr.write(
    'Usage: node scripts/compose.mjs <base|dev|full|full-db> [docker compose arguments]\n',
  );
  process.exitCode = 2;
} else {
  const arguments_ = process.argv.slice(3);
  if (arguments_[0] === '--') arguments_.shift();
  const result = spawnSync('docker', ['compose', ...modes[mode], ...arguments_], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
