'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { CheckCircle2, Dumbbell, ImagePlus, Loader2, MessageCircle, Play, Target, Trophy, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { sendMessageAction, sendImageMessageAction, markChatReadAction } from '@/app/(app)/team/chat/actions';
import { ChatImage } from '@/components/chat/ChatImage';
import { formatSystemEvent } from '@/lib/chat-events';
import { ImageError, prepareChatImage, type PreparedImage } from '@/lib/image-compress';
import { refreshUnread } from '@/lib/unread-store';
import { Avatar } from '@/components/ui/Avatar';
import { resolveAuthorName, FORMER_MEMBER_LABEL } from '@/lib/chat-identity';
import { t } from '@/lib/i18n';
import type { ChatMessage } from '@/lib/data/chat';

const NEAR_BOTTOM_THRESHOLD_PX = 120;

export function ChatRoom({
  teamId,
  currentUserId,
  initialMessages,
  previousReadAt,
}: {
  teamId: string;
  currentUserId: string;
  initialMessages: ChatMessage[];
  previousReadAt: string | null;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const isNearBottomRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachment, setAttachment] = useState<{ prepared: PreparedImage; previewUrl: string } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const activeTeamRef = useRef(teamId);

  // Fixed at mount — the divider marks what was unread when the chat was
  // opened, it should not shift around as more messages arrive live.
  const firstUnreadId = useMemo(() => {
    if (!previousReadAt) return null;
    const boundary = new Date(previousReadAt).getTime();
    const firstUnread = initialMessages.find((m) => new Date(m.created_at).getTime() > boundary);
    // Don't show the divider if every message is unread (nothing to
    // separate "old" from "new" for) or nothing is unread at all.
    return firstUnread && firstUnread !== initialMessages[0] ? firstUnread.id : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            // The chat is open on screen: whatever a teammate just wrote is
            // being read right now, so keep the persisted read state current.
            if (row.user_id !== currentUserId && row.message_type !== 'system' && document.visibilityState === 'visible') {
              markChatReadAction(teamId, row.id)
                .then(() => refreshUnread(teamId))
                .catch(() => undefined);
            }
            const { data: profile } = await supabase.from('profiles').select('full_name, avatar_url').eq('id', row.user_id).maybeSingle();
            setMessages((prev) => [
              ...prev,
              { ...row, authorName: resolveAuthorName(profile), authorAvatar: profile?.avatar_url ?? null },
            ]);
          }
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [teamId, currentUserId]);

  // Mark read once the chat has actually mounted with messages on screen —
  // never as a side effect of the Team page loading or a route prefetch,
  // both of which never run this client component at all.
  useEffect(() => {
    const latest = initialMessages[initialMessages.length - 1];
    // Then re-read the real count so the bottom nav / Team page badge drop to
    // whatever the database now says (0), without a reload.
    markChatReadAction(teamId, latest?.id ?? null)
      .then(() => refreshUnread(teamId))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show the newest messages immediately on open (no scroll animation
  // through history), then only auto-scroll on new arrivals if the user was
  // already near the bottom — respects someone who scrolled up to read.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
      return;
    }
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD_PX;
  }

  useEffect(() => {
    return () => {
      if (attachment) URL.revokeObjectURL(attachment.previewUrl);
    };
  }, [attachment]);

  function clearAttachment() {
    setAttachment(null);
    setSendError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSendError(null);
    setPreparing(true);
    try {
      const prepared = await prepareChatImage(file);
      setAttachment({ prepared, previewUrl: URL.createObjectURL(prepared.thumb) });
    } catch (err) {
      setSendError(err instanceof ImageError ? err.message : 'Das Bild konnte nicht verarbeitet werden.');
    } finally {
      setPreparing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function sendImage(caption: string) {
    if (!attachment) return;
    setSending(true);
    const { prepared } = attachment;
    const storage = createClient().storage.from('chat-media');
    const messageId = crypto.randomUUID();
    const base = `${activeTeamRef.current}/${currentUserId}/${messageId}`;
    const path = `${base}.${prepared.extension}`;
    const thumbPath = `${base}_t.${prepared.extension}`;

    try {
      const full = await storage.upload(path, prepared.full, { contentType: prepared.mime, upsert: false });
      if (full.error) throw new Error('upload');
      const thumb = await storage.upload(thumbPath, prepared.thumb, { contentType: prepared.mime, upsert: false });
      if (thumb.error) throw new Error('upload');

      const res = await sendImageMessageAction({
        teamId: activeTeamRef.current,
        messageId,
        path,
        thumbPath,
        mime: prepared.mime,
        width: prepared.width,
        height: prepared.height,
        caption,
      });
      if (!res.ok) throw new Error(res.error);
      clearAttachment();
    } catch {
      // Nothing was inserted (or the server removed the files); best-effort
      // cleanup of anything that did reach storage, and no broken message.
      await storage.remove([path, thumbPath]).catch(() => undefined);
      setSendError('Foto konnte nicht gesendet werden. Bitte versuche es erneut.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={listRef} onScroll={handleScroll} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-neutral-400">
            <MessageCircle size={30} strokeWidth={1.6} />
            <p className="text-sm">{t('chat.empty.title')}</p>
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.user_id === currentUserId;
            const isFormerMember = m.authorName === FORMER_MEMBER_LABEL;

            if (m.message_type === 'system') {
              return (
                <div key={m.id}>
                  <SystemEventCard message={m} isFirstUnread={m.id === firstUnreadId} label={t('chat.newMessages')} />
                </div>
              );
            }

            return (
              <div key={m.id}>
                {m.id === firstUnreadId && (
                  <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-brand">
                    <span className="h-px flex-1 bg-brand/25" />
                    {t('chat.newMessages')}
                    <span className="h-px flex-1 bg-brand/25" />
                  </div>
                )}
                <div className={`flex items-end gap-2 ${mine ? 'flex-row-reverse' : 'flex-row'}`}>
                  {!mine && <Avatar src={m.authorAvatar} name={m.authorName} size="sm" />}
                  <div className={`flex min-w-0 flex-col ${mine ? 'items-end' : 'items-start'}`}>
                    {!mine && (
                      <span className={`mb-0.5 px-1 text-[11px] font-medium ${isFormerMember ? 'italic text-neutral-500' : 'text-neutral-400'}`}>
                        {m.authorName}
                      </span>
                    )}
                    {m.message_type === 'image' && m.attachment_path && (
                      <ChatImage
                        path={m.attachment_path}
                        thumbPath={typeof m.metadata?.thumb_path === 'string' ? (m.metadata.thumb_path as string) : null}
                        width={m.attachment_width}
                        height={m.attachment_height}
                      />
                    )}
                    {(m.message_type !== 'image' || m.content) && (
                      <button
                        type="button"
                        onClick={() => setReplyTo(m)}
                        className={`mt-0.5 max-w-[70vw] break-words rounded-2xl px-4 py-2.5 text-left text-sm first:mt-0 ${
                          mine ? 'bg-brand text-[#00232A]' : 'bg-neutral-100 text-neutral-900'
                        }`}
                      >
                        {m.content}
                      </button>
                    )}
                    <span className="mt-0.5 px-1 text-[10px] text-neutral-400">
                      {new Date(m.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
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
          setSendError(null);
          if (attachment) {
            await sendImage(String(formData.get('content') || ''));
            formRef.current?.reset();
            setReplyTo(null);
            return;
          }
          await sendMessageAction(formData);
          formRef.current?.reset();
          setReplyTo(null);
        }}
        className="flex shrink-0 flex-col gap-2 border-t border-neutral-200 bg-neutral-100 px-3 py-3"
      >
        <input type="hidden" name="teamId" value={teamId} />
        <input type="hidden" name="replyToId" value={replyTo?.id ?? ''} />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={onPickFile}
        />
        {replyTo && (
          <div className="flex items-center justify-between rounded-lg bg-neutral-100 px-3 py-1.5 text-xs text-neutral-500">
            <span className="truncate">{t('chat.reply')}: {replyTo.message_type === 'image' && !replyTo.content ? 'Foto' : replyTo.content}</span>
            <button type="button" onClick={() => setReplyTo(null)} className="btn-icon -mr-1.5 h-6 w-6 shrink-0">
              <X size={14} strokeWidth={2.25} />
            </button>
          </div>
        )}
        {(attachment || preparing) && (
          <div className="flex items-center gap-3 rounded-xl bg-neutral-150 p-2">
            {attachment ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={attachment.previewUrl} alt="Vorschau" className="h-14 w-14 rounded-lg object-cover" />
            ) : (
              <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-neutral-200/40">
                <Loader2 size={18} className="animate-spin text-neutral-400" />
              </span>
            )}
            <p className="min-w-0 flex-1 text-xs text-neutral-400">
              {sending ? 'Foto wird hochgeladen…' : preparing ? 'Foto wird vorbereitet…' : 'Foto bereit – Text optional hinzufügen.'}
            </p>
            {attachment && !sending && (
              <button type="button" onClick={clearAttachment} className="btn-icon shrink-0" aria-label="Foto entfernen">
                <X size={16} />
              </button>
            )}
          </div>
        )}
        {sendError && <p className="px-1 text-xs font-medium text-red-400">{sendError}</p>}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={preparing || sending}
            className="btn-icon h-11 w-11 shrink-0 bg-neutral-150 text-neutral-500"
            aria-label="Foto anhängen"
          >
            <ImagePlus size={20} strokeWidth={1.9} />
          </button>
          <input
            name="content"
            placeholder={attachment ? 'Bildunterschrift (optional)' : t('chat.placeholder')}
            required={!attachment}
            autoComplete="off"
            className="input-field min-w-0 flex-1"
          />
          <SendButton label={t('chat.send')} />
        </div>
      </form>
    </div>
  );
}

function SendButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary shrink-0 px-4 py-3">
      {pending ? <Loader2 size={16} className="animate-spin" /> : label}
    </button>
  );
}

const EVENT_ICONS = {
  workout_started: Play,
  workout_completed: CheckCircle2,
  weekly_goal_reached: Target,
  challenge_completed: Trophy,
} as const;

function SystemEventCard({ message, isFirstUnread, label }: { message: ChatMessage; isFirstUnread: boolean; label: string }) {
  const Icon = EVENT_ICONS[message.event_type as keyof typeof EVENT_ICONS] ?? Dumbbell;
  return (
    <>
      {isFirstUnread && (
        <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-brand">
          <span className="h-px flex-1 bg-brand/25" />
          {label}
          <span className="h-px flex-1 bg-brand/25" />
        </div>
      )}
      <div className="mx-auto flex max-w-[88%] items-center gap-2 rounded-full border border-brand/15 bg-brand-50/60 px-3.5 py-1.5 text-center text-xs text-neutral-500">
        <Icon size={14} strokeWidth={2} className="shrink-0 text-brand" />
        <span className="min-w-0 break-words">{formatSystemEvent(message.authorName, message.event_type, message.metadata ?? {})}</span>
      </div>
    </>
  );
}
