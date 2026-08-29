import DOMPurify from 'dompurify';
import katex from 'katex';
import MarkdownIt from 'markdown-it';
import type { RuleBlock } from 'markdown-it/lib/parser_block.mjs';
import type { RuleInline } from 'markdown-it/lib/parser_inline.mjs';
import type Token from 'markdown-it/lib/token.mjs';

const SAFE_LINK_PATTERN = /^(?:(?:https?|mailto):|\/(?!\/)|\.{1,2}\/|#|\?)/i;
const CITATION_PATTERN = /\[来源(\d+)\]/g;
const FENCE_START_PATTERN = /(^|\n)```(?:tex|latex|math|markdown)?[^\n]*\n/gim;

interface SafeMarkdownOptions {
  interactiveCitations?: boolean;
}

type TableAlignment = 'center' | 'left' | 'right';

const KATEX_OPTIONS = {
  maxExpand: 1_000,
  maxSize: 50,
  output: 'htmlAndMathml' as const,
  strict: 'ignore' as const,
  throwOnError: false,
  trust: false,
};

function renderMath(source: string, displayMode: boolean): string {
  return katex.renderToString(source.trim().replace(/\\_\{/g, '_{'), {
    ...KATEX_OPTIONS,
    displayMode,
  });
}

function normalizeMalformedMathFence(source: string): string {
  FENCE_START_PATTERN.lastIndex = 0;
  const match = FENCE_START_PATTERN.exec(source);
  if (!match) return source;

  const openingStart = match.index + (match[1]?.length ?? 0);
  const openingEnd = match.index + match[0].length;
  const fencedContent = source.slice(openingEnd);
  const startsWithDisplayMath = /^\s*(?:\$\$|\\\[|\[\\)/.test(fencedContent);
  if (!startsWithDisplayMath || fencedContent.includes('\n```')) return source;

  return `${source.slice(0, openingStart)}${fencedContent}`.replace(
    /^(\$\$[^\n]+\$\$)\n\$\$\s*\n(?=\$\$)/gm,
    '$1\n',
  );
}

function findClosingDelimiter(source: string, start: number, delimiter: string): number {
  let index = source.indexOf(delimiter, start);
  while (index >= 0 && source[index - 1] === '\\') {
    index = source.indexOf(delimiter, index + delimiter.length);
  }
  return index;
}

const mathBlockRule: RuleBlock = (state, startLine, endLine, silent) => {
  if (state.sCount[startLine]! < state.blkIndent) return false;

  const start = state.bMarks[startLine]! + state.tShift[startLine]!;
  const openDelimiter = state.src.slice(start, start + 2);
  const closeDelimiter =
    openDelimiter === '\\[' || openDelimiter === '[\\' ? '\\]' : openDelimiter === '$$' ? '$$' : undefined;
  if (!closeDelimiter) return false;

  const contentStart = start + openDelimiter.length;
  const close = findClosingDelimiter(state.src, contentStart, closeDelimiter);
  if (close < 0) return false;

  let closeLine = startLine;
  while (closeLine < endLine && close >= state.eMarks[closeLine]!) closeLine += 1;
  if (closeLine >= endLine) return false;

  if (silent) return true;

  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content = state.src.slice(contentStart, close);
  token.map = [startLine, closeLine + 1];
  state.line = closeLine + 1;
  return true;
};

const backslashMathInlineRule: RuleInline = (state, silent) => {
  if (state.src.slice(state.pos, state.pos + 2) !== '\\(') return false;

  const contentStart = state.pos + 2;
  const close = findClosingDelimiter(state.src, contentStart, '\\)');
  if (close < 0 || state.src.slice(contentStart, close).includes('\n')) return false;

  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = state.src.slice(contentStart, close);
  }
  state.pos = close + 2;
  return true;
};

const dollarMathInlineRule: RuleInline = (state, silent) => {
  if (state.src[state.pos] !== '$' || state.src[state.pos + 1] === '$') return false;

  const contentStart = state.pos + 1;
  if (!state.src[contentStart] || /\s/.test(state.src[contentStart])) return false;

  const close = findClosingDelimiter(state.src, contentStart, '$');
  if (
    close < 0 ||
    close === contentStart ||
    /\s/.test(state.src[close - 1]!) ||
    state.src.slice(contentStart, close).includes('\n')
  ) {
    return false;
  }

  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = state.src.slice(contentStart, close);
  }
  state.pos = close + 1;
  return true;
};

function tableAlignment(token: Token | undefined): TableAlignment | undefined {
  const alignment = token?.attrGet('style')?.match(/^text-align:(left|center|right)$/)?.[1];
  return alignment as TableAlignment | undefined;
}

function renderTableCell(tokens: Token[], index: number, tag: 'td' | 'th'): string {
  const alignment = tableAlignment(tokens[index]);
  const classes = [
    tag === 'th' ? 'markdown-table-heading' : 'markdown-table-cell',
    alignment ? `markdown-table-align--${alignment}` : undefined,
  ]
    .filter(Boolean)
    .join(' ');
  return `<${tag} class="${classes}">`;
}

function orderedListMarker(tokens: Token[], index: number): string | undefined {
  const itemLevel = tokens[index]?.level;
  if (itemLevel === undefined) return undefined;

  let parentIndex = index - 1;
  while (parentIndex >= 0) {
    const token = tokens[parentIndex];
    if (token?.level === itemLevel - 1 && token.type.endsWith('_list_open')) break;
    parentIndex -= 1;
  }
  const parent = tokens[parentIndex];
  if (parent?.type !== 'ordered_list_open') return undefined;

  const start = Number(parent.attrGet('start') ?? 1);
  const previousItems = tokens
    .slice(parentIndex + 1, index)
    .filter((token) => token.type === 'list_item_open' && token.level === itemLevel).length;
  return `${Number.isSafeInteger(start) && start > 0 ? start + previousItems : previousItems + 1}.`;
}

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: false,
  typographer: false,
});

markdown.validateLink = (url: string): boolean => SAFE_LINK_PATTERN.test(url.trim());
markdown.block.ruler.before('fence', 'math_block', mathBlockRule);
markdown.inline.ruler.before('escape', 'math_inline_backslash', backslashMathInlineRule);
markdown.inline.ruler.before('escape', 'math_inline_dollar', dollarMathInlineRule);

const defaultTextRenderer =
  markdown.renderer.rules.text ??
  ((tokens, index): string => markdown.utils.escapeHtml(tokens[index]?.content ?? ''));

markdown.renderer.rules.text = (tokens, index, options, environment, renderer): string =>
  defaultTextRenderer(tokens, index, options, environment, renderer).replace(
    CITATION_PATTERN,
    (citation, sourceIndex: string) =>
      (environment as SafeMarkdownOptions).interactiveCitations
        ? `<button type="button" class="kb-answer-citation kb-answer-citation--interactive" data-source-index="${sourceIndex}" aria-label="查看来源 ${sourceIndex}">${citation}</button>`
        : `<small class="kb-answer-citation">${citation}</small>`,
  );

const defaultLinkOpenRenderer =
  markdown.renderer.rules.link_open ??
  ((tokens, index, options, _environment, renderer): string =>
    renderer.renderToken(tokens, index, options));
const defaultFenceRenderer =
  markdown.renderer.rules.fence ??
  ((tokens, index, options, _environment, renderer): string =>
    renderer.renderToken(tokens, index, options));
const defaultCodeBlockRenderer =
  markdown.renderer.rules.code_block ??
  ((tokens, index): string =>
    `<pre><code>${markdown.utils.escapeHtml(tokens[index]?.content ?? '')}</code></pre>\n`);

markdown.renderer.rules.blockquote_open = () => '<blockquote class="markdown-quote">\n';
markdown.renderer.rules.code_inline = (tokens, index): string =>
  `<code class="markdown-code markdown-code--inline">${markdown.utils.escapeHtml(tokens[index]?.content ?? '')}</code>`;
markdown.renderer.rules.em_open = () => '<em class="markdown-emphasis">';
markdown.renderer.rules.strong_open = () => '<strong class="markdown-strong">';
markdown.renderer.rules.s_open = () => '<s class="markdown-strikethrough">';
markdown.renderer.rules.hr = () => '<hr class="markdown-divider">\n';
markdown.renderer.rules.hardbreak = () => '<br class="markdown-break">\n';
markdown.renderer.rules.softbreak = () => '<br class="markdown-break">\n';
markdown.renderer.rules.fence = (tokens, index, options, environment, renderer): string => {
  tokens[index]?.attrJoin('class', 'markdown-code markdown-code--block');
  return defaultFenceRenderer(tokens, index, options, environment, renderer).replace(
    '<pre>',
    '<pre class="markdown-code-block">',
  );
};
markdown.renderer.rules.code_block = (tokens, index, options, environment, renderer): string => {
  tokens[index]?.attrJoin('class', 'markdown-code markdown-code--block');
  return defaultCodeBlockRenderer(tokens, index, options, environment, renderer)
    .replace('<pre>', '<pre class="markdown-code-block">')
    .replace('<code>', '<code class="markdown-code markdown-code--block">');
};
markdown.renderer.rules.link_open = (tokens, index, options, environment, renderer): string => {
  tokens[index]?.attrJoin('class', 'markdown-link');
  tokens[index]?.attrSet('target', '_blank');
  tokens[index]?.attrSet('rel', 'noopener noreferrer');
  return defaultLinkOpenRenderer(tokens, index, options, environment, renderer);
};
markdown.renderer.rules.table_open = () =>
  '<div class="markdown-table-scroll" role="region" aria-label="Markdown 表格" tabindex="0"><table class="markdown-table">\n';
markdown.renderer.rules.table_close = () => '</table></div>\n';
markdown.renderer.rules.thead_open = () => '<thead class="markdown-table-head">\n';
markdown.renderer.rules.tbody_open = () => '<tbody class="markdown-table-body">\n';
markdown.renderer.rules.tr_open = () => '<tr class="markdown-table-row">';
markdown.renderer.rules.th_open = (tokens, index) => renderTableCell(tokens, index, 'th');
markdown.renderer.rules.td_open = (tokens, index) => renderTableCell(tokens, index, 'td');

markdown.renderer.rules.paragraph_open = (tokens, index) =>
  tokens[index]?.hidden ? '' : '<div class="markdown-paragraph">';
markdown.renderer.rules.paragraph_close = (tokens, index) =>
  tokens[index]?.hidden ? '' : '</div>';
markdown.renderer.rules.bullet_list_open = () => '<div class="markdown-list" role="list">';
markdown.renderer.rules.bullet_list_close = () => '</div>';
markdown.renderer.rules.ordered_list_open = () =>
  '<div class="markdown-list markdown-list--ordered" role="list">';
markdown.renderer.rules.ordered_list_close = () => '</div>';
markdown.renderer.rules.list_item_open = (tokens, index): string => {
  const marker = orderedListMarker(tokens, index);
  return marker
    ? `<div class="markdown-list-item markdown-list-item--ordered" role="listitem" data-list-marker="${marker}">`
    : '<div class="markdown-list-item markdown-list-item--bullet" role="listitem">';
};
markdown.renderer.rules.list_item_close = () => '</div>';
markdown.renderer.rules.heading_open = (tokens, index): string => {
  const level = tokens[index]?.tag.replace('h', '') ?? '2';
  return `<div class="markdown-heading markdown-heading--h${level} kb-heading kb-heading--h${level}" role="heading" aria-level="${level}">`;
};
markdown.renderer.rules.heading_close = () => '</div>';
markdown.renderer.rules.math_block = (tokens, index): string =>
  `${renderMath(tokens[index]?.content ?? '', true)}\n`;
markdown.renderer.rules.math_inline = (tokens, index): string =>
  renderMath(tokens[index]?.content ?? '', false);

export function renderSafeMarkdown(source: string, options: SafeMarkdownOptions = {}): string {
  const sanitized = DOMPurify.sanitize(markdown.render(normalizeMalformedMathFence(source), options), {
    ALLOWED_TAGS: [
      'a',
      'blockquote',
      'br',
      'button',
      'code',
      'del',
      'div',
      'em',
      'hr',
      'pre',
      's',
      'small',
      'span',
      'strong',
      'table',
      'tbody',
      'td',
      'th',
      'thead',
      'tr',
      'annotation',
      'math',
      'mfrac',
      'mi',
      'mn',
      'mo',
      'mover',
      'mrow',
      'msqrt',
      'msub',
      'msubsup',
      'msup',
      'mtext',
      'munder',
      'munderover',
      'semantics',
    ],
    ALLOWED_ATTR: [
      'aria-label',
      'aria-level',
      'class',
      'data-list-marker',
      'data-source-index',
      'encoding',
      'href',
      'rel',
      'role',
      'target',
      'tabindex',
      'title',
      'type',
      'style',
      'xmlns',
    ],
    ALLOWED_URI_REGEXP: SAFE_LINK_PATTERN,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    FORBID_TAGS: ['embed', 'form', 'iframe', 'img', 'object', 'script', 'style', 'svg'],
    FORBID_ATTR: ['id'],
  });
  const template = document.createElement('template');
  template.innerHTML = sanitized;
  template.content.querySelectorAll('.kb-answer-citation--interactive').forEach((citation) => {
    citation.setAttribute('type', 'button');
  });
  template.content.querySelectorAll('.markdown-table-scroll').forEach((table) => {
    table.setAttribute('tabindex', '0');
  });
  template.content.querySelectorAll('.markdown-link').forEach((link) => {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  });
  return template.innerHTML;
}
