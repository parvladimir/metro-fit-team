'use client';

import { CornerUpLeft, ImageIcon } from 'lucide-react';
import { DELETED_QUOTE_TEXT, type QuoteInfo } from '@/lib/chat-quote';

/** Compact reference to the message a reply answers. Tap → scroll to + highlight it.
 * Sits at the top of the reply (bubbles and creator cards), never duplicates the whole message. */
export function QuoteBlock({ quote, onJump, tone = 'default' }: { quote: QuoteInfo; onJump: (id: string) => void; tone?: 'default' | 'own' }) {
  const own = tone === 'own';
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!quote.deleted) onJump(quote.id);
      }}
      disabled={quote.deleted}
      aria-label={quote.deleted ? DELETED_QUOTE_TEXT : `Zur Nachricht von ${quote.authorName} springen`}
      className={`mb-2 flex w-full min-w-0 flex-col rounded-lg border-l-[3px] px-2.5 py-1.5 text-left transition active:opacity-80 ${
        own ? 'border-[#00232A]/50 bg-[#00232A]/10' : 'border-brand/70 bg-brand/[0.08]'
      } ${quote.deleted ? 'cursor-default' : ''}`}
    >
      {quote.deleted ? (
        <span className={`flex items-center gap-1.5 text-xs italic ${own ? 'text-[#00232A]/70' : 'text-neutral-500'}`}>
          <CornerUpLeft size={12} className="shrink-0" />
          {DELETED_QUOTE_TEXT}
        </span>
      ) : (
        <>
          <span className={`truncate text-[11px] font-bold ${own ? 'text-[#00232A]' : 'text-brand'}`}>{quote.authorName}</span>
          <span className={`flex items-start gap-1 text-xs leading-snug ${own ? 'text-[#00232A]/80' : 'text-neutral-600'}`}>
            {quote.isImage && <ImageIcon size={12} className="mt-0.5 shrink-0" />}
            <span className="line-clamp-3 min-w-0 break-words [overflow-wrap:anywhere]">{quote.preview || (quote.isImage ? 'Foto' : '')}</span>
          </span>
        </>
      )}
    </button>
  );
}
