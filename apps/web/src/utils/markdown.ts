import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';

const SAFE_LINK_PATTERN = /^(?:(?:https?|mailto):|\/(?!\/)|\.{1,2}\/|#|\?)/i;
const CITATION_PATTERN = /\[来源\d+\]/g;

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
    '<small class="answer-citation">$&</small>',
  );

export function renderSafeMarkdown(source: string): string {
  const sanitized = DOMPurify.sanitize(markdown.render(source), {
    ALLOWED_TAGS: [
      'a',
      'blockquote',
      'br',
      'code',
      'del',
      'em',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'hr',
      'li',
      'ol',
      'p',
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
      'ul',
    ],
    ALLOWED_ATTR: ['class', 'href', 'title'],
    ALLOWED_URI_REGEXP: SAFE_LINK_PATTERN,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    FORBID_TAGS: ['embed', 'form', 'iframe', 'img', 'object', 'script', 'style', 'svg'],
    FORBID_ATTR: ['id', 'style'],
  });
  const template = document.createElement('template');
  template.innerHTML = sanitized;
  template.content.querySelectorAll('a').forEach((link) => {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  });
  return template.innerHTML;
}
