import { stripMarkdown } from '@/lib/chat-format';

/** What a reply shows about the message it answers. Built from the ORIGINAL row
 * (never copied into the reply), so edits/deletes of the original stay accurate. */
export interface QuoteInfo {
  id: string;
  authorName: string;
  /** 1–3 lines of plain text; empty for photo-only originals */
  preview: string;
  isImage: boolean;
  /** original was soft-deleted → show the placeholder */
  deleted: boolean;
}

export const QUOTE_PREVIEW_MAX = 160;
export const DELETED_QUOTE_TEXT = 'Ursprüngliche Nachricht wurde gelöscht';

export function quotePreview(content: string): string {
  const plain = stripMarkdown(content);
  return plain.length > QUOTE_PREVIEW_MAX ? `${plain.slice(0, QUOTE_PREVIEW_MAX - 1).trimEnd()}…` : plain;
}

export function quoteFromMessage(m: { id: string; authorName: string; content: string; message_type: string; deleted_at?: string | null }): QuoteInfo {
  return {
    id: m.id,
    authorName: m.authorName,
    preview: quotePreview(m.content),
    isImage: m.message_type === 'image',
    deleted: !!m.deleted_at,
  };
}
