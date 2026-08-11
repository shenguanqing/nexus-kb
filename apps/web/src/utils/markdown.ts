import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';

const SAFE_LINK_PATTERN = /^(?:(?:https?|mailto):|\/(?!\/)|\.{1,2}\/|#|\?)/i;
const CITATION_PATTERN = /\[来源(\d+)\]/g;

interface SafeMarkdownOptions {
  interactiveCitations?: boolean;
}

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: false,
  typographer: false,
});

markdown.validateLink = (url: string): boolean => SAFE_LINK_PATTERN.test(url.trim());

const defaultTextRenderer =
  markdown.renderer.rules.text ??
  ((tokens, index): string => markdown.utils.escapeHtml(tokens[index]?.content ?? ''));

markdown.renderer.rules.text = (tokens, index, options, environment, renderer): string =>
  defaultTextRenderer(tokens, index, options, environment, renderer).replace(
    CITATION_PATTERN,
    (citation, sourceIndex: string) =>
      (environment as SafeMarkdownOptions).interactiveCitations
        ? `<button type="button" class="answer-citation" data-source-index="${sourceIndex}" aria-label="查看来源 ${sourceIndex}">${citation}</button>`
        : `<small class="answer-citation">${citation}</small>`,
  );

markdown.renderer.rules.paragraph_open = () => '<div class="markdown-paragraph">';
markdown.renderer.rules.paragraph_close = () => '</div>';
markdown.renderer.rules.bullet_list_open = () => '<div class="markdown-list">';
markdown.renderer.rules.bullet_list_close = () => '</div>';
markdown.renderer.rules.ordered_list_open = () =>
  '<div class="markdown-list markdown-list--ordered">';
markdown.renderer.rules.ordered_list_close = () => '</div>';
markdown.renderer.rules.list_item_open = () => '<div class="markdown-list-item">';
markdown.renderer.rules.list_item_close = () => '</div>';
markdown.renderer.rules.heading_open = (tokens, index): string => {
  const level = tokens[index]?.tag.replace('h', '') ?? '2';
  return `<div class="markdown-heading markdown-heading--h${level}" role="heading" aria-level="${level}">`;
};
markdown.renderer.rules.heading_close = () => '</div>';

export function renderSafeMarkdown(source: string, options: SafeMarkdownOptions = {}): string {
  const sanitized = DOMPurify.sanitize(markdown.render(source, options), {
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
      'strong',
      'table',
      'tbody',
      'td',
      'th',
      'thead',
      'tr',
    ],
    ALLOWED_ATTR: [
      'aria-label',
      'aria-level',
      'class',
      'data-source-index',
      'href',
      'role',
      'title',
      'type',
    ],
    ALLOWED_URI_REGEXP: SAFE_LINK_PATTERN,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    FORBID_TAGS: ['embed', 'form', 'iframe', 'img', 'object', 'script', 'style', 'svg'],
    FORBID_ATTR: ['id', 'style'],
  });
  const template = document.createElement('template');
  template.innerHTML = sanitized;
  template.content.querySelectorAll('button.answer-citation').forEach((citation) => {
    citation.setAttribute('type', 'button');
  });
  template.content.querySelectorAll('a').forEach((link) => {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  });
  return template.innerHTML;
}
