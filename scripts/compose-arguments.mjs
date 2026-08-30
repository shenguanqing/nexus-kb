export const composeModes = {
  base: [],
  dev: ['--profile', 'configuration'],
  oidc: ['-f', 'compose.yaml', '-f', 'compose.oidc.yaml', '--profile', 'configuration'],
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

export function composeArguments(mode, arguments_, runtimeEnvironmentExists) {
  if (!Object.hasOwn(composeModes, mode)) return null;
  const forwarded = arguments_[0] === '--' ? arguments_.slice(1) : [...arguments_];
  const environmentFiles = ['--env-file', '.env'];
  if (runtimeEnvironmentExists) {
    environmentFiles.push('--env-file', 'config/runtime.env');
  }
  return [...composeModes[mode], ...environmentFiles, ...forwarded];
}
