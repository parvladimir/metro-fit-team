'use client';

import { useState } from 'react';
import { ChevronDown, Heart, Loader2, MessageCircle, Send } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { MAX_REPLY_LENGTH, repliesLabel, shouldCollapseReplies, type EventReply, type EventSocial as Social } from '@/lib/event-social';

/** Reactions + one-level reply thread underneath an activity event card. The
 * card itself stays a distinct motivational event — this only adds controls. */
export function EventSocial({
  social,
  currentUserId,
  onToggleSupport,
  onSendReply,
  ownerName,
}: {
  social: Social;
  currentUserId: string;
  onToggleSupport: () => void;
  onSendReply: (text: string) => Promise<string | null>;
  ownerName: string;
}) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supported = social.reactors.includes(currentUserId);
  const count = social.reactors.length;
  const replies = social.replies;
  const collapsed = shouldCollapseReplies(replies.length, expanded);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    const err = await onSendReply(text);
    setSending(false);
    if (err) return setError(err);
    setText('');
    setComposerOpen(false);
    setExpanded(true);
  }

  return (
    <div className="mx-auto mt-1.5 flex w-full max-w-[88%] flex-col gap-2">
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={onToggleSupport}
          aria-pressed={supported}
          aria-label={supported ? 'Unterstützung zurücknehmen' : 'Training unterstützen'}
          className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition active:scale-95 ${
            supported ? 'bg-brand/15 text-brand ring-1 ring-brand/40' : 'bg-neutral-150 text-neutral-500'
          }`}
        >
          <Heart size={14} strokeWidth={2.25} className={supported ? 'fill-current' : ''} />
          {count > 0 ? count : 'Unterstützen'}
        </button>
        <button
          type="button"
          onClick={() => setComposerOpen((v) => !v)}
          aria-expanded={composerOpen}
          className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full bg-neutral-150 px-3 text-xs font-semibold text-neutral-500 transition active:scale-95"
        >
          <MessageCircle size={14} strokeWidth={2.25} />
          {replies.length > 0 ? repliesLabel(replies.length) : 'Antworten'}
        </button>
      </div>

      {replies.length > 0 && (
        <div className="flex flex-col gap-1.5 border-l border-brand/20 pl-3">
          {collapsed ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex items-center gap-1 self-start text-xs font-semibold text-brand"
            >
              <ChevronDown size={14} />
              {repliesLabel(replies.length)} anzeigen
            </button>
          ) : (
            replies.map((r) => <ReplyRow key={r.id} reply={r} mine={r.user_id === currentUserId} />)
          )}
        </div>
      )}

      {composerOpen && (
        <form onSubmit={submit} className="flex flex-col gap-1.5">
          <p className="px-1 text-[11px] text-neutral-400">Antwort an {ownerName}</p>
          <div className="flex items-center gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={MAX_REPLY_LENGTH}
              placeholder="Stark! Viel Erfolg 💪"
              autoFocus
              autoComplete="off"
              aria-label="Antwort schreiben"
              className="input-field min-w-0 flex-1 !py-2 text-sm"
            />
            <button type="submit" disabled={sending || !text.trim()} className="btn-primary shrink-0 px-3.5 py-2 text-xs" aria-label="Antwort senden">
              {sending ? <Loader2 size={14} className="animate-spin" /> : <><Send size={14} /> Senden</>}
            </button>
          </div>
          {error && <p className="px-1 text-xs font-medium text-red-400">{error}</p>}
        </form>
      )}
    </div>
  );
}

function ReplyRow({ reply, mine }: { reply: EventReply; mine: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <Avatar src={reply.authorAvatar} name={reply.authorName} size="sm" className="!h-6 !w-6 !text-[10px]" />
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-neutral-700 [overflow-wrap:anywhere]">
        <span className={`font-semibold ${mine ? 'text-brand' : 'text-neutral-900'}`}>{mine ? 'Du' : reply.authorName}: </span>
        {reply.content}
      </p>
    </div>
  );
}
