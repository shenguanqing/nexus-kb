import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

const root = process.cwd();
const markdownFiles = execFileSync(
  'git',
  ['-c', 'core.quotePath=false', 'ls-files', '-co', '-z', '--exclude-standard', '--', '*.md'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean)
  .sort();

const findings = [];
const headingCache = new Map();

function withoutFencedCode(content) {
  let fence = null;
  return content
    .split(/\r?\n/)
    .map((line) => {
      const marker = line.match(/^\s*(```|~~~)/)?.[1] ?? null;
      if (marker && fence === null) {
        fence = marker;
        return '';
      }
      if (marker === fence) {
        fence = null;
        return '';
      }
      return fence === null ? line : '';
    })
    .join('\n');
}

function githubSlug(value) {
  let slug = '';
  for (const character of value
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, '')) {
    if (character === '-' || character === '_') {
      slug += character;
    } else if (/[\p{P}\p{S}]/u.test(character)) {
      continue;
    } else {
      slug += /\s/u.test(character) ? '-' : character;
    }
  }
  return slug;
}

function markdownHeadings(file) {
  if (headingCache.has(file)) return headingCache.get(file);
  const headings = new Set();
  const duplicates = new Map();
  for (const line of withoutFencedCode(readFileSync(file, 'utf8')).split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/)?.[1];
    if (!heading) continue;
    const base = githubSlug(heading);
    const occurrence = duplicates.get(base) ?? 0;
    duplicates.set(base, occurrence + 1);
    headings.add(occurrence === 0 ? base : `${base}-${occurrence}`);
  }
  headingCache.set(file, headings);
  return headings;
}

function checkLocalLinks(file) {
  const content = withoutFencedCode(readFileSync(file, 'utf8'));
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of content.matchAll(linkPattern)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(rawTarget)) continue;

    const line = content.slice(0, match.index).split('\n').length;
    const hashIndex = rawTarget.indexOf('#');
    const rawPath = hashIndex === -1 ? rawTarget : rawTarget.slice(0, hashIndex);
    const rawFragment = hashIndex === -1 ? '' : rawTarget.slice(hashIndex + 1);
    let decodedPath;
    let decodedFragment;
    try {
      decodedPath = decodeURIComponent(rawPath);
      decodedFragment = decodeURIComponent(rawFragment).toLowerCase();
    } catch {
      findings.push(`${file}:${line} 包含无法解码的本地链接：${rawTarget}`);
      continue;
    }

    const destination = decodedPath
      ? resolve(root, dirname(file), decodedPath)
      : resolve(root, file);
    if (!existsSync(destination)) {
      findings.push(`${file}:${line} 本地链接不存在：${rawTarget}`);
      continue;
    }
    if (
      decodedFragment &&
      statSync(destination).isFile() &&
      extname(destination).toLowerCase() === '.md' &&
      !markdownHeadings(destination).has(decodedFragment)
    ) {
      findings.push(`${file}:${line} Markdown 锚点不存在：${rawTarget}`);
    }
  }
}

function openApiEndpoints() {
  const endpoints = new Set();
  let currentPath = null;
  for (const line of readFileSync('packages/contracts/openapi/api.v1.yaml', 'utf8').split(
    /\r?\n/,
  )) {
    const pathMatch = line.match(/^  (\/[^:]+):\s*$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }
    const method = line.match(/^    (get|post|put|patch|delete):\s*$/)?.[1];
    if (currentPath && method) endpoints.add(`${method.toUpperCase()} ${currentPath}`);
  }
  return endpoints;
}

function documentedApiEndpoints() {
  const endpoints = new Set();
  const content = readFileSync('docs/07-API使用说明.md', 'utf8');
  const rowPattern = /^\|\s*`(GET|POST|PUT|PATCH|DELETE)`\s*\|\s*`([^`]+)`/gm;
  for (const match of content.matchAll(rowPattern)) endpoints.add(`${match[1]} ${match[2]}`);
  return endpoints;
}

function compareSets(label, expected, actual) {
  const missing = [...expected].filter((value) => !actual.has(value));
  const extra = [...actual].filter((value) => !expected.has(value));
  if (missing.length > 0) findings.push(`${label} 缺少：${missing.join(', ')}`);
  if (extra.length > 0) findings.push(`${label} 多出：${extra.join(', ')}`);
}

function checkRerankProviderDocumentation() {
  const config = readFileSync('apps/api/src/config/app-config.ts', 'utf8');
  const enumBody = config.match(/const rerankProviderSchema = z\.enum\(\[([^\]]+)]\)/)?.[1];
  if (!enumBody) {
    findings.push('无法从 app-config.ts 读取 Rerank Provider enum');
    return;
  }
  const configured = [...enumBody.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const design = readFileSync('docs/02-技术设计.md', 'utf8');
  const documented = design
    .match(/^Rerank:\s+(.+)$/m)?.[1]
    ?.split('|')
    .map((value) => value.trim());
  if (!documented) {
    findings.push('技术设计缺少 Rerank Provider 目录');
    return;
  }
  compareSets('Rerank Provider 文档', new Set(configured), new Set(documented));
}

function checkBreakpointThresholds() {
  const allowed = new Set(['767', '768', '900', '901', '1279', '1280']);
  const files = [
    'apps/web/src/styles/main.css',
    'apps/web/src/styles/tokens.css',
    'apps/web/src/styles/breakpoints.scss',
    'apps/web/src/composables/useBreakpoint.ts',
  ];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(/\((?:min|max)-width:\s*(\d+)px\)/g)) {
      if (!allowed.has(match[1])) findings.push(`${file} 使用了未登记的视口断点 ${match[1]}px`);
    }
  }
}

if (!markdownFiles.includes('docs/README.md')) {
  findings.push('docs/README.md 未纳入 Git 可跟踪文件集');
}
for (const file of markdownFiles) checkLocalLinks(file);
compareSets('docs/07 API 端点目录', openApiEndpoints(), documentedApiEndpoints());
checkRerankProviderDocumentation();
checkBreakpointThresholds();

if (findings.length > 0) {
  console.error(findings.join('\n'));
  process.exit(1);
}

console.log(
  `Documentation checks passed (${markdownFiles.length} Markdown files, ${openApiEndpoints().size} API endpoints).`,
);
