'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { sendMessageAction } from '@/app/(app)/team/chat/actions';
import { Avatar } from '@/components/ui/Avatar';
import { t } from '@/lib/i18n';
import type { ChatMessage } from '@/lib/data/chat';

export function ChatRoom({ teamId, currentUserId, initialMessages }: { teamId: string; currentUserId: string; initialMessages: ChatMessage[] }) {
  const [messages, setMessages] = useState(initialMessages);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    // IMPORTANT: @supabase/ssr's browser client loads the session from
    // cookies asynchronously. Subscribing before that resolves opens the
    // realtime socket unauthenticated, so RLS silently filters out every
    // change (no error, no events — just nothing arrives, ever). Explicitly
    // attaching the access token to the realtime client before subscribing
    // fixes it. Discovered via manual testing: messages saved correctly but
    // never appeared live, in both dev and production builds.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session) supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`messages:${teamId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `team_id=eq.${teamId}` },
          async (payload) => {
            const row = payload.new as ChatMessage;
            const { data: profile } = await supabase.from('profiles').select('full_name, avatar_url').eq('id', row.user_id).single();
            setMessages((prev) => [...prev, { ...row, authorName: profile?.full_name || 'Mitglied', authorAvatar: profile?.avatar_url ?? null }]);
          }
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [teamId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-neutral-400">
            <MessageCircle size={30} strokeWidth={1.6} />
            <p className="text-sm">{t('chat.empty.title')}</p>
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.user_id === currentUserId;
            return (
              <div key={m.id} className={`flex items-end gap-2 ${mine ? 'flex-row-reverse' : 'flex-row'}`}>
                {!mine && <Avatar src={m.authorAvatar} name={m.authorName} size="sm" />}
                <div className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                  {!mine && <span className="mb-0.5 px-1 text-[11px] font-medium text-neutral-400">{m.authorName}</span>}
                  <button
                    type="button"
                    onClick={() => setReplyTo(m)}
                    className={`max-w-[70vw] rounded-2xl px-4 py-2.5 text-left text-sm ${
                      mine ? 'bg-brand text-[#00232A]' : 'bg-neutral-100 text-neutral-900'
                    }`}
                  >
                    {m.content}
                  </button>
                  <span className="mt-0.5 px-1 text-[10px] text-neutral-400">
                    {new Date(m.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form
        ref={formRef}
        action={async (formData) => {
          await sendMessageAction(formData);
          formRef.current?.reset();
          setReplyTo(null);
        }}
        className="flex flex-col gap-2 border-t border-neutral-200 bg-neutral-100 px-3 py-3"
      >
        <input type="hidden" name="teamId" value={teamId} />
        <input type="hidden" name="replyToId" value={replyTo?.id ?? ''} />
        {replyTo && (
          <div className="flex items-center justify-between rounded-lg bg-neutral-100 px-3 py-1.5 text-xs text-neutral-500">
            <span className="truncate">{t('chat.reply')}: {replyTo.content}</span>
            <button type="button" onClick={() => setReplyTo(null)} className="btn-icon -mr-1.5 h-6 w-6 shrink-0">
              <X size={14} strokeWidth={2.25} />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            name="content"
            placeholder={t('chat.placeholder')}
            required
            autoComplete="off"
            className="input-field flex-1"
          />
          <button type="submit" className="btn-primary px-4 py-3">{t('chat.send')}</button>
        </div>
      </form>
    </div>
  );
}
