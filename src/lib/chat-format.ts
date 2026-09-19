/**
 * Chat text is stored as (a small subset of) Markdown source. These helpers
 * turn pasted clipboard content into that format BEFORE saving, and back into
 * plain text for previews. Rendering lives in <ChatMarkdown> (raw HTML off).
 */

const BULLET_CHARS = '•◦▪▫‣⁃·●○■□◆◇';
const BULLET_RE = new RegExp(`^[ \\t]*[${BULLET_CHARS}][ \\t]+`, 'gm');

/** Plain-text paste: unify newlines, turn "•" style bullets into "- ", tidy blank lines. */
export function normalizePlainPaste(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(BULLET_RE, '- ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const SAFE_HREF = /^(https?:|mailto:)/i;

type NodeLike = {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<NodeLike>;
  getAttribute?: (name: string) => string | null;
};

const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'TR']);
const SKIP_TAGS = new Set(['STYLE', 'SCRIPT', 'META', 'HEAD', 'TITLE', 'IMG', 'SVG', 'BUTTON']);

function isNormalWeight(el: NodeLike): boolean {
  // Google Docs / some copy sources wrap everything in <b style="font-weight:normal">.
  const style = el.getAttribute?.('style') ?? '';
  return /font-weight:\s*(normal|400)/i.test(style);
}

function inline(node: NodeLike, ctx: { pre: boolean }): string {
  if (node.nodeType === 3) {
    const text = node.textContent ?? '';
    return ctx.pre ? text : text.replace(/\s+/g, ' ');
  }
  if (node.nodeType !== 1) return '';
  const tag = node.nodeName.toUpperCase();
  if (SKIP_TAGS.has(tag)) return '';
  const kids = () => Array.from(node.childNodes).map((c) => inline(c, ctx)).join('');

  switch (tag) {
    case 'BR':
      return '\n';
    case 'STRONG':
    case 'B': {
      const inner = kids();
      if (isNormalWeight(node) || !inner.trim()) return inner;
      return `**${inner.trim()}**`;
    }
    case 'EM':
    case 'I': {
      const inner = kids();
      return inner.trim() ? `*${inner.trim()}*` : inner;
    }
    case 'CODE':
      return kids().trim() ? `\`${kids().trim()}\`` : '';
    case 'A': {
      const href = node.getAttribute?.('href') ?? '';
      const text = kids().trim();
      if (!SAFE_HREF.test(href)) return text;
      return !text || text === href ? href : `[${text}](${href})`;
    }
    case 'UL':
    case 'OL':
      return `\n\n${list(node, ctx, 0)}\n\n`;
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      const inner = kids().trim();
      return inner ? `\n\n**${inner.replace(/\*\*/g, '')}**\n\n` : '';
    }
    case 'PRE':
      return `\n\n${(node.textContent ?? '').trim()}\n\n`;
    default:
      return BLOCK_TAGS.has(tag) ? `\n\n${kids()}\n\n` : kids();
  }
}

function list(node: NodeLike, ctx: { pre: boolean }, depth: number): string {
  const ordered = node.nodeName.toUpperCase() === 'OL';
  const indent = '  '.repeat(depth);
  const lines: string[] = [];
  let n = 1;
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType !== 1 || child.nodeName.toUpperCase() !== 'LI') continue;
    let text = '';
    const nested: string[] = [];
    for (const part of Array.from(child.childNodes)) {
      const t = part.nodeName.toUpperCase();
      if (part.nodeType === 1 && (t === 'UL' || t === 'OL')) nested.push(list(part, ctx, depth + 1));
      else text += inline(part, ctx);
    }
    text = text.replace(/\n{2,}/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
    if (!text && nested.length === 0) continue;
    lines.push(`${indent}${ordered ? `${n++}.` : '-'} ${text}`);
    lines.push(...nested);
  }
  return lines.join('\n');
}

/** Converts a pasted HTML fragment (ChatGPT, web pages, Docs) to the supported Markdown subset. */
export function htmlToMarkdown(root: NodeLike): string {
  const raw = Array.from(root.childNodes).map((c) => inline(c, { pre: false })).join('');
  return raw
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+(?=\S)(?![-\d*])/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Browser entry point: prefer rich HTML from the clipboard, else normalised plain text. */
export function clipboardToMarkdown(
  data: { html: string; text: string },
  parse: (html: string) => NodeLike
): string {
  if (data.html && /<(p|div|ul|ol|li|strong|b|em|i|a|br|h[1-6])[\s>/]/i.test(data.html)) {
    const md = htmlToMarkdown(parse(data.html));
    if (md) return md;
  }
  return normalizePlainPaste(data.text);
}

/** Markdown → readable plain text (push previews, reply previews). */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((?:https?:|mailto:)[^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+/gm, '• ')
    .replace(/\s*\n+\s*/g, ' ')
    .trim();
}

/** Only http(s)/mailto links are ever rendered as links. */
export function safeUrl(url: string): string {
  return SAFE_HREF.test(url.trim()) ? url : '';
}
