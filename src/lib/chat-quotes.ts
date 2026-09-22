/**
 * Inline quoted phrases: „…“ “…” "..." «…» get a subtle color accent, same
 * spirit as @mentions. Deliberately conservative — only a quote whose open
 * AND close mark sit in the very same Markdown text node is styled; anything
 * that would require reasoning across sibling nodes (bold, links, line
 * breaks) is left as plain text rather than guessed at. In this app's actual
 * messages that already covers the normal case, since remark already splits
 * text nodes at every other inline element.
 */

export type QuotePart = { type: 'text'; value: string } | { type: 'quote'; value: string };

// Each open mark has exactly one valid partner. „ and " are never ambiguous
// with each other; only ASCII " plays both roles, handled separately below.
const OPEN_TO_CLOSE: Record<string, string> = {
  '„': '“', // „ ... "
  '“': '”', // " ... "
  '«': '»', // « ... »
};
const ASCII_QUOTE = '"';
const MAX_QUOTE_LENGTH = 300;

function isDigit(ch: string | undefined): boolean {
  return !!ch && ch >= '0' && ch <= '9';
}

interface OpenMatch {
  index: number;
  mark: string;
  close: string;
}

/** Earliest valid opening mark at or after `from`. A straight `"` never
 * counts when it's glued to a digit on either side — 27" is a measurement,
 * not a quote — so `12"x18"` never gets misread as one quoted phrase. */
function findOpen(text: string, from: number): OpenMatch | null {
  let best: OpenMatch | null = null;
  for (const [mark, close] of Object.entries(OPEN_TO_CLOSE)) {
    const i = text.indexOf(mark, from);
    if (i !== -1 && (best === null || i < best.index)) best = { index: i, mark, close };
  }
  let i = text.indexOf(ASCII_QUOTE, from);
  while (i !== -1) {
    if (!isDigit(text[i - 1])) {
      if (best === null || i < best.index) best = { index: i, mark: ASCII_QUOTE, close: ASCII_QUOTE };
      break;
    }
    i = text.indexOf(ASCII_QUOTE, i + 1);
  }
  return best;
}

/** The specific close mark at or after `from`, with the same digit guard for `"`. */
function findClose(text: string, from: number, close: string): number | null {
  let i = text.indexOf(close, from);
  if (close !== ASCII_QUOTE) return i === -1 ? null : i;
  while (i !== -1) {
    if (!isDigit(text[i + 1])) return i;
    i = text.indexOf(close, i + 1);
  }
  return null;
}

/** Splits one text node's value into plain/quoted parts. A mark with no
 * matching partner anywhere in this same string (or a candidate that would
 * span an implausibly long run of text) is left as ordinary text — never
 * guessed at, never carried into the next text node. */
export function splitTextByQuotes(text: string): QuotePart[] {
  const parts: QuotePart[] = [];
  let searchFrom = 0;
  let plainStart = 0;
  while (searchFrom < text.length) {
    const open = findOpen(text, searchFrom);
    if (!open) break;
    const closeIdx = findClose(text, open.index + open.mark.length, open.close);
    if (closeIdx === null || closeIdx + open.close.length - open.index > MAX_QUOTE_LENGTH) {
      // Unmatched (or absurdly long) — treat this mark as plain text and
      // keep looking for a real pair later in the same string.
      searchFrom = open.index + open.mark.length;
      continue;
    }
    if (open.index > plainStart) parts.push({ type: 'text', value: text.slice(plainStart, open.index) });
    parts.push({ type: 'quote', value: text.slice(open.index, closeIdx + open.close.length) });
    searchFrom = closeIdx + open.close.length;
    plainStart = searchFrom;
  }
  if (plainStart < text.length) parts.push({ type: 'text', value: text.slice(plainStart) });
  return parts;
}
