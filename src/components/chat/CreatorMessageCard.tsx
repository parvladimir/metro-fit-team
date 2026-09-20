'use client';

import { useState } from 'react';
import { Crown, ShieldCheck, Sparkles } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { ChatMarkdown } from '@/components/chat/ChatMarkdown';
import type { MessageMention } from '@/lib/mentions';

const CREATOR_HINT = 'Ersteller der METRO Fit Team App';

/** Elegant card for messages from the verified creator account. Presentation
 * only — it grants nothing. Text uses the creator font; links, paragraphs and
 * long German words wrap safely. */
export function CreatorMessageCard({
  name,
  avatar,
  content,
  time,
  onReply,
  children,
  menu,
  editor,
  edited = false,
  mentions = [],
  currentUserId = null,
}: {
  name: string;
  avatar: string | null;
  content: string;
  time: string;
  onReply: () => void;
  /** Optional attachment (image) rendered between header and text. */
  children?: React.ReactNode;
  /** Own-message actions (Bearbeiten / Löschen) shown in the header. */
  menu?: React.ReactNode;
  /** When set, replaces the rendered text with the inline editor. */
  editor?: React.ReactNode;
  edited?: boolean;
  mentions?: MessageMention[];
  currentUserId?: string | null;
}) {
  const [hint, setHint] = useState(false);

  return (
    <article
      aria-label={`Nachricht vom Ersteller: ${name}`}
      className="w-full max-w-[min(100%,26rem)] rounded-2xl border border-brand/35 bg-[#081d24] p-3.5 shadow-[0_0_28px_-10px_rgba(0,215,245,0.45)]"
    >
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <Avatar src={avatar} name={name} size="sm" className="ring-1 ring-brand/40" />
        <p className="min-w-0 max-w-full shrink-0 grow break-words font-creator text-sm font-semibold text-neutral-900 min-[380px]:whitespace-nowrap">{name}</p>
        <div className="flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand ring-1 ring-brand/30">
            <ShieldCheck size={12} strokeWidth={2.25} aria-hidden />
            Super Admin
          </span>
          <button
            type="button"
            onClick={() => setHint((v) => !v)}
            aria-expanded={hint}
            title={CREATOR_HINT}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-neutral-700 ring-1 ring-neutral-300/60"
          >
            <Crown size={12} strokeWidth={2.25} aria-hidden />
            Creator
          </button>
        </div>
        {menu && <div className="ml-auto">{menu}</div>}
      </header>
      {hint && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-neutral-500">
          <Sparkles size={12} className="shrink-0 text-brand" aria-hidden />
          {CREATOR_HINT}
        </p>
      )}

      {children && <div className="mt-3">{children}</div>}

      {editor ? (
        <div className="mt-3">{editor}</div>
      ) : content && (
        <div
          onClick={onReply}
          className="mt-3 cursor-pointer font-creator text-[15px] leading-[1.6] text-neutral-900"
        >
          <ChatMarkdown text={content} mentions={mentions} currentUserId={currentUserId} />
        </div>
      )}

      <p className="mt-2 text-right text-[10px] text-neutral-400">
        {edited && <span className="mr-1.5 italic">bearbeitet</span>}
        {time}
      </p>
    </article>
  );
}
