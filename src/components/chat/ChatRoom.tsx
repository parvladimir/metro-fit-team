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
import { CreatorMessageCard } from '@/components/chat/CreatorMessageCard';
import { fetchCreators, isCreatorCardMessage } from '@/lib/creator';
import { ChatMarkdown } from '@/components/chat/ChatMarkdown';
import { clipboardToMarkdown } from '@/lib/chat-format';
import { MessageActions } from '@/components/chat/MessageActions';
import { MessageEditor } from '@/components/chat/MessageEditor';
import { editMessageAction, deleteMessageAction } from '@/app/(app)/team/chat/actions';
import { EventSocial } from '@/components/chat/EventSocial';
import { addReplyOnce, applyReaction, EMPTY_SOCIAL, type EventSocial as Social } from '@/lib/event-social';
import { toggleSupportAction, sendEventReplyAction, markNotificationsReadAction } from '@/app/(app)/team/chat/actions';
import { refreshNotificationCount } from '@/lib/notification-store';
import { MentionInput, type MentionInputHandle } from '@/components/chat/MentionInput';
import { stillMentioned, type MentionMember, type MessageMention } from '@/lib/mentions';
import { t } from '@/lib/i18n';
import type { ChatMessage } from '@/lib/data/chat';

const NEAR_BOTTOM_THRESHOLD_PX = 120;

export function ChatRoom({
  teamId,
  currentUserId,
  initialMessages,
  previousReadAt,
  initialSocial,
  focusMessageId,
  members,
  initialMentions,
}: {
  teamId: string;
  currentUserId: string;
  initialMessages: ChatMessage[];
  previousReadAt: string | null;
  initialSocial: Record<string, Social>;
  focusMessageId: string | null;
  members: MentionMember[];
  initialMentions: Record<string, MessageMention[]>;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [social, setSocial] = useState(initialSocial);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mentionsMap, setMentionsMap] = useState(initialMentions);
  const [draft, setDraft] = useState('');
  const [picked, setPicked] = useState<MentionMember[]>([]);
  const mentionsOf = (id: string) => mentionsMap[id] ?? [];
  const updateSocial = (id: string, fn: (s: Social) => Social) =>
    setSocial((prev) => ({ ...prev, [id]: fn(prev[id] ?? EMPTY_SOCIAL) }));
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
  const composerRef = useRef<MentionInputHandle>(null);

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  // Formatted pastes (ChatGPT, web, Docs) are converted to the app's Markdown
  // subset BEFORE saving — never raw HTML, never flattened to one paragraph.
  function onComposerPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (!html && !text) return;
    const md = clipboardToMarkdown({ html, text }, (h) => new DOMParser().parseFromString(h, 'text/html').body);
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.setRangeText(md, start, end, 'end');
    setDraft(el.value);
    autoGrow(el);
  }

  // Desktop: Enter sends, Shift+Enter = new line. Touch devices: Enter = new line.
  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;
    e.preventDefault();
    formRef.current?.requestSubmit();
  }

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
            // Replies belong to an event thread: never a main-chat bubble and
            // never counted/marked as team-chat unread.
            if (row.parent_message_id) {
              const { data: p } = await supabase.from('profiles').select('full_name, avatar_url').eq('id', row.user_id).maybeSingle();
              updateSocial(row.parent_message_id, (cur) => ({
                ...cur,
                replies: addReplyOnce(cur.replies, {
                  id: row.id,
                  user_id: row.user_id,
                  content: row.content,
                  created_at: row.created_at,
                  authorName: resolveAuthorName(p),
                  authorAvatar: p?.avatar_url ?? null,
                }),
              }));
              return;
            }
            // The chat is open on screen: whatever a teammate just wrote is
            // being read right now, so keep the persisted read state current.
            if (row.user_id !== currentUserId && row.message_type !== 'system' && document.visibilityState === 'visible') {
              markChatReadAction(teamId, row.id)
                .then(() => refreshUnread(teamId))
                .catch(() => undefined);
            }
            const { data: profile } = await supabase.from('profiles').select('full_name, avatar_url').eq('id', row.user_id).maybeSingle();
            const creators = await fetchCreators(supabase, [row.user_id]);
            setMessages((prev) => [
              ...prev,
              {
                ...row,
                authorName: resolveAuthorName(profile),
                authorAvatar: profile?.avatar_url ?? null,
                creatorName: creators.get(row.user_id)?.displayName ?? null,
              },
            ]);
          }
        )
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `team_id=eq.${teamId}` }, (payload) => {
          // Edits/deletes of an existing message: update the SAME entry in
          // place. No unread/push side effects — this is not an insert.
          const row = payload.new as ChatMessage;
          if (row.parent_message_id) return;
          if (row.deleted_at) {
            setMessages((prev) => prev.filter((m) => m.id !== row.id));
          } else {
            setMessages((prev) => prev.map((m) => (m.id === row.id ? { ...m, content: row.content, edited_at: row.edited_at, metadata: row.metadata } : m)));
          }
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_mentions', filter: `team_id=eq.${teamId}` }, (payload) => {
          const r = payload.new as { message_id: string; mentioned_user_id: string; mention_text: string };
          setMentionsMap((prev) => {
            const cur = prev[r.message_id] ?? [];
            if (cur.some((x) => x.userId === r.mentioned_user_id)) return prev;
            return { ...prev, [r.message_id]: [...cur, { userId: r.mentioned_user_id, text: r.mention_text }] };
          });
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_mentions', filter: `team_id=eq.${teamId}` }, (payload) => {
          const r = payload.old as { message_id?: string; mentioned_user_id?: string };
          if (r.message_id && r.mentioned_user_id) {
            setMentionsMap((prev) => ({ ...prev, [r.message_id!]: (prev[r.message_id!] ?? []).filter((x) => x.userId !== r.mentioned_user_id) }));
          }
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions', filter: `team_id=eq.${teamId}` }, (payload) => {
          const r = payload.new as { message_id: string; user_id: string };
          updateSocial(r.message_id, (cur) => ({ ...cur, reactors: applyReaction(cur.reactors, r.user_id, true) }));
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions', filter: `team_id=eq.${teamId}` }, (payload) => {
          const r = payload.old as { message_id?: string; user_id?: string };
          if (r.message_id && r.user_id) {
            updateSocial(r.message_id, (cur) => ({ ...cur, reactors: applyReaction(cur.reactors, r.user_id!, false) }));
          }
        })
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, currentUserId]);

  // Deep link from a push / notification: scroll to the event, highlight it
  // briefly, and mark that event's notifications as read.
  useEffect(() => {
    if (!focusMessageId) return;
    const timer = setTimeout(() => {
      document.getElementById(`msg-${focusMessageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightId(focusMessageId);
    }, 150);
    const clear = setTimeout(() => setHighlightId(null), 3200);
    markNotificationsReadAction(focusMessageId)
      .then(() => refreshNotificationCount(currentUserId))
      .catch(() => undefined);
    return () => {
      clearTimeout(timer);
      clearTimeout(clear);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMessageId]);

  async function saveEdit(id: string, text: string, mentionIds: string[]): Promise<string | null> {
    const res = await editMessageAction(id, text, mentionIds);
    if (!res.ok) return res.error;
    setMentionsMap((prev) => ({ ...prev, [id]: res.mentions }));
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: res.content, edited_at: res.edited_at } : m)));
    setEditingId(null);
    return null;
  }

  async function removeMessage(id: string) {
    const res = await deleteMessageAction(id);
    if (res.ok) setMessages((prev) => prev.filter((m) => m.id !== id));
  }

  function toggleSupport(eventId: string) {
    const had = (social[eventId] ?? EMPTY_SOCIAL).reactors.includes(currentUserId);
    updateSocial(eventId, (cur) => ({ ...cur, reactors: applyReaction(cur.reactors, currentUserId, !had) }));
    toggleSupportAction(eventId)
      .then((res) => {
        // Server is the source of truth: revert an optimistic change that failed.
        if (!res.ok) updateSocial(eventId, (cur) => ({ ...cur, reactors: applyReaction(cur.reactors, currentUserId, had) }));
        else updateSocial(eventId, (cur) => ({ ...cur, reactors: applyReaction(cur.reactors, currentUserId, res.reacted) }));
      })
      .catch(() => updateSocial(eventId, (cur) => ({ ...cur, reactors: applyReaction(cur.reactors, currentUserId, had) })));
  }

  async function sendReply(eventId: string, text: string, mentionIds: string[]): Promise<string | null> {
    const res = await sendEventReplyAction(eventId, text, mentionIds);
    if (!res.ok) return res.error;
    updateSocial(eventId, (cur) => ({ ...cur, replies: addReplyOnce(cur.replies, res.reply) }));
    return null;
  }

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

  async function sendImage(caption: string, mentionUserIds: string[] = []) {
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
        mentionUserIds,
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
      <div ref={listRef} onScroll={handleScroll} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-3 pt-4">
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
                <div
                  key={m.id}
                  id={`msg-${m.id}`}
                  className={`rounded-2xl transition-shadow duration-500 ${highlightId === m.id ? 'shadow-[0_0_0_2px_rgba(0,215,245,0.55)]' : ''}`}
                >
                  <SystemEventCard message={m} isFirstUnread={m.id === firstUnreadId} label={t('chat.newMessages')} />
                  <EventSocial
                    social={social[m.id] ?? EMPTY_SOCIAL}
                    currentUserId={currentUserId}
                    ownerName={m.user_id === currentUserId ? 'dich selbst' : m.authorName.split(' ')[0] || m.authorName}
                    onToggleSupport={() => toggleSupport(m.id)}
                    members={members}
                    onSendReply={(text, ids) => sendReply(m.id, text, ids)}
                  />
                </div>
              );
            }

            if (isCreatorCardMessage(m, m.creatorName ? { displayName: m.creatorName } : null)) {
              return (
                <div
                  key={m.id}
                  id={`msg-${m.id}`}
                  className={`flex flex-col rounded-2xl transition-shadow duration-500 ${highlightId === m.id ? 'shadow-[0_0_0_2px_rgba(0,215,245,0.55)]' : ''}`}
                >
                  {m.id === firstUnreadId && (
                    <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-brand">
                      <span className="h-px flex-1 bg-brand/25" />
                      {t('chat.newMessages')}
                      <span className="h-px flex-1 bg-brand/25" />
                    </div>
                  )}
                  <CreatorMessageCard
                    name={m.creatorName!}
                    avatar={m.authorAvatar}
                    content={m.message_type === 'image' || m.content ? m.content : ''}
                    time={new Date(m.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                    onReply={() => setReplyTo(m)}
                    edited={!!m.edited_at}
                    mentions={mentionsOf(m.id)}
                    currentUserId={currentUserId}
                    menu={mine ? <MessageActions onEdit={() => setEditingId(m.id)} onDelete={() => removeMessage(m.id)} /> : undefined}
                    editor={
                      editingId === m.id ? (
                        <MessageEditor initial={m.content} members={members} initialMentions={mentionsOf(m.id)} onSave={(text, ids) => saveEdit(m.id, text, ids)} onCancel={() => setEditingId(null)} />
                      ) : undefined
                    }
                  >
                    {m.message_type === 'image' && m.attachment_path && (
                      <ChatImage
                        fluid
                        path={m.attachment_path}
                        thumbPath={typeof m.metadata?.thumb_path === 'string' ? (m.metadata.thumb_path as string) : null}
                        width={m.attachment_width}
                        height={m.attachment_height}
                      />
                    )}
                  </CreatorMessageCard>
                </div>
              );
            }

            return (
              <div
                key={m.id}
                id={`msg-${m.id}`}
                className={`rounded-2xl transition-shadow duration-500 ${highlightId === m.id ? 'shadow-[0_0_0_2px_rgba(0,215,245,0.55)]' : ''}`}
              >
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
                    {editingId === m.id ? (
                      <div className="mt-0.5 w-[78vw] max-w-full rounded-2xl bg-neutral-100 p-3">
                        <MessageEditor initial={m.content} members={members} initialMentions={mentionsOf(m.id)} onSave={(text, ids) => saveEdit(m.id, text, ids)} onCancel={() => setEditingId(null)} />
                      </div>
                    ) : (
                      (m.message_type !== 'image' || m.content) && (
                        <div className="mt-0.5 flex items-start gap-1 first:mt-0">
                          {mine && <MessageActions onEdit={() => setEditingId(m.id)} onDelete={() => removeMessage(m.id)} />}
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => setReplyTo(m)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') setReplyTo(m);
                            }}
                            className={`min-w-0 max-w-[78vw] cursor-pointer rounded-2xl px-4 py-2.5 text-left text-sm leading-relaxed ${
                              mine
                                ? 'bg-gradient-to-b from-[#2fe3fb] to-[#00c4e2] text-[#00232A] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_6px_14px_-8px_rgba(0,215,245,0.5)]'
                                : 'border border-white/[0.08] bg-surface-3 text-neutral-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                            }`}
                          >
                            <ChatMarkdown text={m.content} tone={mine ? 'bubble-own' : 'bubble'} mentions={mentionsOf(m.id)} currentUserId={currentUserId} />
                          </div>
                        </div>
                      )
                    )}
                    <span className="mt-0.5 px-1 text-[10px] text-neutral-400">
                      {m.edited_at && <span className="mr-1 italic">bearbeitet</span>}
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
          const ids = stillMentioned(draft, picked).map((m) => m.id);
          if (attachment) {
            await sendImage(String(formData.get('content') || ''), ids);
          } else {
            formData.set('mentions', JSON.stringify(ids));
            await sendMessageAction(formData);
          }
          formRef.current?.reset();
          setDraft('');
          setPicked([]);
          if (composerRef.current?.el) composerRef.current.el.style.height = 'auto';
          setReplyTo(null);
        }}
        className="flex shrink-0 flex-col gap-2 border-t border-white/[0.08] bg-surface-2 px-3 py-3 shadow-[inset_0_1px_0_rgba(0,215,245,0.12)]"
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
            className="btn-icon h-11 w-11 shrink-0 border border-white/[0.08] bg-surface-3 text-neutral-600"
            aria-label="Foto anhängen"
          >
            <ImagePlus size={20} strokeWidth={1.9} />
          </button>
          <MentionInput
            ref={composerRef}
            value={draft}
            onValueChange={(v) => {
              setDraft(v);
              requestAnimationFrame(() => composerRef.current?.el && autoGrow(composerRef.current.el));
            }}
            members={members}
            onPick={(m) => setPicked((p) => (p.some((x) => x.id === m.id) ? p : [...p, m]))}
            name="content"
            rows={1}
            maxLength={2000}
            placeholder={attachment ? 'Bildunterschrift (optional)' : t('chat.placeholder')}
            required={!attachment}
            autoComplete="off"
            onInput={(e) => autoGrow(e.currentTarget)}
            onPaste={onComposerPaste}
            onKeyDown={onComposerKeyDown}
            className="input-field max-h-40 min-w-0 flex-1 resize-none overflow-y-auto leading-snug"
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
      <div className="mx-auto flex max-w-[88%] items-center gap-2 rounded-full border border-brand/25 bg-gradient-to-b from-brand/[0.12] to-brand/[0.04] px-3.5 py-1.5 text-center text-xs text-neutral-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
        <Icon size={14} strokeWidth={2} className="shrink-0 text-brand" />
        <span className="min-w-0 break-words">{formatSystemEvent(message.authorName, message.event_type, message.metadata ?? {})}</span>
      </div>
    </>
  );
}
