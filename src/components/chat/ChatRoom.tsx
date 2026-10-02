'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ImagePlus, Layers, Loader2, MessageCircle, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { sendMessageAction, sendImageMessageAction, markChatReadAction, loadOlderMessagesAction, loadMessagesUntilAction, type OlderMessagesResult } from '@/app/(app)/team/chat/actions';
import { pinMessageAction, unpinMessageAction } from '@/app/(app)/team/chat/pin-actions';
import { PinnedMessageStrip } from '@/components/chat/PinnedMessageStrip';
import { Sheet } from '@/components/ui/Sheet';
import { PIN_SELECT, pinFromRow, type PinnedMessage } from '@/lib/chat-pin';
import { withdrawShareAction } from '@/app/(app)/team/chat/share-actions';
import { cancelTrainingInviteAction, setRsvpAction } from '@/app/(app)/team/training/actions';
import { TrainingInviteCard } from '@/components/training/TrainingInviteCard';
import { ChatImage } from '@/components/chat/ChatImage';
import { SharedPlanCard } from '@/components/sharing/SharedPlanCard';
import { ShareDetailSheet } from '@/components/sharing/ShareDetailSheet';
import { ImportShareDialog } from '@/components/sharing/ImportShareDialog';
import { SharePickerSheet } from '@/components/sharing/SharePickerSheet';
import type { PlanShareForViewer, PlanShareWithItems } from '@/lib/data/plan-shares';
import type { PlanTemplateWithItems } from '@/lib/data/plan-templates';
import { TRAINING_INVITE_SELECT, applyOwnRsvp, toInviteForViewer, type RawInviteRow, type RsvpStatus, type TrainingInviteForViewer } from '@/lib/training-invites';
import { SystemEventCard } from '@/components/chat/SystemEventCard';
import { isSameLocalDay, formatChatDayLabel } from '@/lib/date';
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
import { addReplyOnce, EMPTY_SOCIAL, type EventSocial as Social } from '@/lib/event-social';
import { ReactionChips } from '@/components/chat/ReactionChips';
import { applyReactionToggle, type ReactionKey, type ReactionsByUser } from '@/lib/reactions';
import { setReactionAction, sendEventReplyAction, markNotificationsReadAction } from '@/app/(app)/team/chat/actions';
import { refreshNotificationCount } from '@/lib/notification-store';
import { MentionInput, type MentionInputHandle } from '@/components/chat/MentionInput';
import { QuoteBlock } from '@/components/chat/QuoteBlock';
import { quoteFromMessage, quotePreview, type QuoteInfo } from '@/lib/chat-quote';
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
  initialReactions,
  focusMessageId,
  members,
  initialMentions,
  initialHasMore,
  initialQuotes,
  initialShares,
  initialInvites,
  myTemplates,
  isTeamAdmin,
  initialPin,
  pinAvailable,
}: {
  teamId: string;
  currentUserId: string;
  initialMessages: ChatMessage[];
  previousReadAt: string | null;
  initialSocial: Record<string, Social>;
  initialReactions: Record<string, ReactionsByUser>;
  focusMessageId: string | null;
  members: MentionMember[];
  initialMentions: Record<string, MessageMention[]>;
  initialHasMore: boolean;
  initialQuotes: Record<string, QuoteInfo>;
  initialShares: Record<string, PlanShareForViewer>;
  initialInvites: Record<string, TrainingInviteForViewer>;
  myTemplates: PlanTemplateWithItems[];
  /** The viewer is a real team_admin of this team (the database decides again on every pin / unpin). */
  isTeamAdmin: boolean;
  initialPin: PinnedMessage | null;
  /** False while the database has no pin table yet: no strip, no "Anheften". */
  pinAvailable: boolean;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [quotes, setQuotes] = useState(initialQuotes);
  const quoteOf = (m: { reply_to_id: string | null }) => (m.reply_to_id ? quotes[m.reply_to_id] ?? null : null);
  const [shares, setShares] = useState(initialShares);
  const [viewingShare, setViewingShare] = useState<PlanShareForViewer | null>(null);
  const [savingShare, setSavingShare] = useState<PlanShareForViewer | null>(null);
  const [pickingTemplate, setPickingTemplate] = useState(false);
  // "Wer ist dabei?" cards, keyed by message id. The ref mirrors the state so the
  // realtime handlers (created once per mount) always see the current cards.
  const [invites, setInvites] = useState(initialInvites);
  const invitesRef = useRef(initialInvites);
  const inviteTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Own answers currently in flight per invitation: a live refresh that lands
  // meanwhile must not overwrite the tap the user just made.
  const pendingRsvpRef = useRef<Map<string, number>>(new Map());
  // The one pinned message of this team. The ref mirrors the state for the realtime handlers (created once per mount).
  const [pin, setPin] = useState<PinnedMessage | null>(initialPin);
  const pinRef = useRef<PinnedMessage | null>(initialPin);
  pinRef.current = pin;
  const [pinBusy, setPinBusy] = useState(false);
  const [confirmPin, setConfirmPin] = useState<ChatMessage | null>(null);
  const [pinNotice, setPinNotice] = useState<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>(initialMessages);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const restoreScrollRef = useRef<number | null>(null);
  const [social, setSocial] = useState(initialSocial);
  const [reactions, setReactions] = useState(initialReactions);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mentionsMap, setMentionsMap] = useState(initialMentions);
  const [draft, setDraft] = useState('');
  const [picked, setPicked] = useState<MentionMember[]>([]);
  const mentionsOf = (id: string) => mentionsMap[id] ?? [];
  const updateSocial = (id: string, fn: (s: Social) => Social) =>
    setSocial((prev) => ({ ...prev, [id]: fn(prev[id] ?? EMPTY_SOCIAL) }));
  const updateReactions = (messageId: string, userId: string, key: ReactionKey, active: boolean) =>
    setReactions((prev) => ({ ...prev, [messageId]: applyReactionToggle(prev[messageId] ?? {}, userId, key, active) }));
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
    let channels: ReturnType<typeof supabase.channel>[] = [];
    let cancelled = false;
    const inviteTimers = inviteTimersRef.current; // a stable Map, never reassigned

    /** Fetches one invitation and replaces its card. `expectedMessageId` is set when the
     * hint came from a message's metadata: only an invitation actually bound to THAT message
     * may render there (a member can write arbitrary metadata on their own message). */
    async function fetchInvite(inviteId: string, expectedMessageId?: string) {
      const { data } = await supabase.from('training_invites').select(TRAINING_INVITE_SELECT).eq('id', inviteId).maybeSingle();
      if (!data || cancelled) return;
      const raw = data as unknown as RawInviteRow;
      if (expectedMessageId && raw.message_id !== expectedMessageId) return;
      const next = toInviteForViewer(raw, currentUserId);
      setInvites((prev) => {
        const existing = prev[next.messageId];
        const keepMine = existing && (pendingRsvpRef.current.get(next.id) ?? 0) > 0;
        return { ...prev, [next.messageId]: keepMine ? { ...next, myStatus: existing.myStatus } : next };
      });
    }
    /** One trailing 250ms-debounced refetch per invitation, however many events arrive. */
    function scheduleInviteRefetch(inviteId: string) {
      if (!Object.values(invitesRef.current).some((i) => i.id === inviteId)) return; // not on screen
      clearTimeout(inviteTimers.get(inviteId));
      inviteTimers.set(inviteId, setTimeout(() => { inviteTimers.delete(inviteId); void fetchInvite(inviteId); }, 250));
    }

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

      // The core chat channel: only tables that have always existed and are published.
      const main = supabase
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
            // A reply arrives with its relation (reply_to_id); resolve what it answers.
            if (row.reply_to_id) {
              const { data: o } = await supabase
                .from('messages')
                .select('id, content, message_type, deleted_at, profiles(full_name)')
                .eq('id', row.reply_to_id)
                .maybeSingle();
              if (o) {
                const orig = o as unknown as { id: string; content: string; message_type: string; deleted_at: string | null; profiles: { full_name: string | null } | null };
                setQuotes((prev) => ({ ...prev, [orig.id]: quoteFromMessage({ id: orig.id, authorName: resolveAuthorName(orig.profiles), content: orig.content, message_type: orig.message_type, deleted_at: orig.deleted_at }) }));
              }
            }
            // A share card carries a cheap hint in metadata so only an actual
            // share message costs an extra lookup, never every plain message.
            const alreadyHave = messagesRef.current.some((m) => m.id === row.id);
            const shareId = typeof row.metadata?.plan_share_id === 'string' ? row.metadata.plan_share_id : null;
            if (!alreadyHave && shareId) {
              const { data: s } = await supabase
                .from('plan_shares')
                .select('*, plan_share_items(*), profiles(full_name)')
                .eq('id', shareId)
                .maybeSingle();
              // Only a share actually bound to THIS message may render on it — a member can
              // write arbitrary metadata on their own message, so the hint alone proves nothing.
              if (s && (s as unknown as { message_id: string }).message_id === row.id) {
                const { plan_share_items, profiles, ...share } = s as unknown as PlanShareWithItems & {
                  plan_share_items: PlanShareWithItems['items'];
                  profiles: { full_name: string | null } | null;
                };
                setShares((prev) => ({
                  ...prev,
                  [row.id]: {
                    ...share,
                    authorName: profiles?.full_name?.trim() || 'Ein Teammitglied',
                    items: [...plan_share_items].sort((a, b) => a.position - b.position),
                    savedTemplateId: null,
                  },
                }));
              }
            }
            // Same idea for a joint-training card: the invitation id rides in the
            // message's metadata from its very first INSERT.
            const inviteHintId = typeof row.metadata?.training_invite_id === 'string' ? row.metadata.training_invite_id : null;
            if (!alreadyHave && inviteHintId) await fetchInvite(inviteHintId, row.id);
            // The sender already added the persisted row from the server response —
            // the message id is the source of truth, so never add it twice.
            setMessages((prev) =>
              prev.some((m) => m.id === row.id)
                ? prev
                : [
                    ...prev,
                    {
                      ...row,
                      authorName: resolveAuthorName(profile),
                      authorAvatar: profile?.avatar_url ?? null,
                      creatorName: creators.get(row.user_id)?.displayName ?? null,
                    },
                  ]
            );
          }
        )
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `team_id=eq.${teamId}` }, (payload) => {
          // Edits/deletes of an existing message: update the SAME entry in
          // place. No unread/push side effects — this is not an insert.
          const row = payload.new as ChatMessage;
          if (row.parent_message_id) return;
          // The pin shows the ORIGINAL message: keep its preview in step with an edit, drop it with a delete.
          if (pinRef.current?.id === row.id) {
            if (row.deleted_at) setPin(null);
            else setPin((prev) => (prev && prev.id === row.id ? { ...prev, preview: quotePreview(row.content) } : prev));
          }
          if (row.deleted_at) {
            setMessages((prev) => prev.filter((m) => m.id !== row.id));
            setQuotes((prev) => (prev[row.id] ? { ...prev, [row.id]: { ...prev[row.id]!, deleted: true } } : prev));
          } else {
            setQuotes((prev) => (prev[row.id] ? { ...prev, [row.id]: { ...prev[row.id]!, preview: quotePreview(row.content) } } : prev));
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
          const r = payload.new as { message_id: string; user_id: string; reaction_type: ReactionKey };
          updateReactions(r.message_id, r.user_id, r.reaction_type, true);
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions', filter: `team_id=eq.${teamId}` }, (payload) => {
          // Each (message, user, emoji) triple is its own row now — there is
          // no more "replace" (no UPDATE ever happens on this table), only
          // this one specific emoji being added or removed.
          const r = payload.old as { message_id?: string; user_id?: string; reaction_type?: ReactionKey };
          if (r.message_id && r.user_id && r.reaction_type) updateReactions(r.message_id, r.user_id, r.reaction_type, false);
        })
        .subscribe();

      // Card updates live on their OWN channels. Realtime rejects a whole channel when any
      // one binding names a table that does not exist or is not in the publication, and a
      // channel that is rejected delivers nothing — so a card feature whose table is not
      // available (e.g. the app is deployed a moment before its migration, or a table was
      // never published) must never be able to silence live messages, reactions and
      // mentions. Each of these only ever costs its own live updates.
      const sharesChannel = supabase
        .channel(`plan-shares:${teamId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'plan_shares', filter: `team_id=eq.${teamId}` }, (payload) => {
          // Only withdrawn_at ever changes after publish (the snapshot itself
          // is immutable) — reflect it live for every viewer, not just the author.
          const row = payload.new as { message_id: string; withdrawn_at: string | null };
          setShares((prev) => (prev[row.message_id] ? { ...prev, [row.message_id]: { ...prev[row.message_id]!, withdrawn_at: row.withdrawn_at } } : prev));
        })
        .subscribe();

      const trainingChannel = supabase
        .channel(`training-invites:${teamId}`)
        // Any real change to an invitation arrives as an UPDATE — its own edits and
        // cancellation, and every change to an answer (including a removal, whose
        // DELETE event could not be routed to a card, via the rsvp_version bump).
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'training_invites', filter: `team_id=eq.${teamId}` }, (payload) => {
          scheduleInviteRefetch((payload.new as { id: string }).id);
        })
        // Belt and braces: new / changed answers also announce themselves directly.
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'training_invite_rsvps', filter: `team_id=eq.${teamId}` }, (payload) => {
          scheduleInviteRefetch((payload.new as { invite_id: string }).invite_id);
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'training_invite_rsvps', filter: `team_id=eq.${teamId}` }, (payload) => {
          scheduleInviteRefetch((payload.new as { invite_id: string }).invite_id);
        })
        .subscribe();

      const tracked = [main, sharesChannel, trainingChannel];
      // The pin gets its own channel too: a missing / unpublished table can then only cost the pin's live update.
      if (pinAvailable) {
        const refetchPin = async () => {
          const { data } = await supabase.from('team_chat_pins').select(PIN_SELECT).eq('team_id', teamId).maybeSingle();
          if (!cancelled) setPin(pinFromRow(data));
        };
        tracked.push(
          supabase
            .channel(`chat-pin:${teamId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'team_chat_pins', filter: `team_id=eq.${teamId}` }, () => {
              void refetchPin();
            })
            // Whatever changed between the page render and this subscription is picked up here.
            .subscribe((status) => {
              if (status === 'SUBSCRIBED') void refetchPin();
            }),
        );
      }
      channels = tracked;
    });

    return () => {
      cancelled = true;
      inviteTimers.forEach((timer) => clearTimeout(timer));
      inviteTimers.clear();
      channels.forEach((c) => supabase.removeChannel(c));
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

  /** Adds a message exactly as the server stored it (id = source of truth). */
  function addPersisted(message: ChatMessage, mentions: MessageMention[]) {
    setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
    if (mentions.length) setMentionsMap((prev) => ({ ...prev, [message.id]: mentions }));
  }

  /** Same as addPersisted, but for a shared-plan card (message + its snapshot). */
  function addPersistedShare(message: ChatMessage, share: PlanShareWithItems) {
    addPersisted(message, []);
    setShares((prev) => ({ ...prev, [message.id]: { ...share, savedTemplateId: null } }));
  }

  function markShareSaved(shareId: string, templateId: string) {
    setShares((prev) => {
      const entry = Object.entries(prev).find(([, s]) => s.id === shareId);
      if (!entry) return prev;
      return { ...prev, [entry[0]]: { ...entry[1], savedTemplateId: templateId } };
    });
  }

  async function withdrawShare(shareId: string) {
    const res = await withdrawShareAction(shareId);
    if (!res.ok) return;
    setShares((prev) => {
      const entry = Object.entries(prev).find(([, s]) => s.id === shareId);
      if (!entry) return prev;
      return { ...prev, [entry[0]]: { ...entry[1], withdrawn_at: new Date().toISOString() } };
    });
  }

  /** The viewer's own answer on a "Wer ist dabei?" card — optimistic, like setReaction: the
   * tap shows at once; a failure puts back what it replaced, unless a newer tap already
   * changed it again. The realtime refresh then confirms whatever actually landed. */
  async function setRsvp(invite: TrainingInviteForViewer, next: RsvpStatus | null) {
    const previous = invitesRef.current[invite.messageId]?.myStatus ?? null;
    pendingRsvpRef.current.set(invite.id, (pendingRsvpRef.current.get(invite.id) ?? 0) + 1);
    setInvites((prev) => (prev[invite.messageId] ? { ...prev, [invite.messageId]: applyOwnRsvp(prev[invite.messageId]!, next) } : prev));
    let ok = false;
    try {
      const res = await setRsvpAction(invite.id, next);
      ok = res.ok;
      if (!res.ok) setSendError(res.error);
    } catch {
      ok = false;
      setSendError('Das hat nicht geklappt. Bitte versuche es noch einmal.');
    } finally {
      const left = (pendingRsvpRef.current.get(invite.id) ?? 1) - 1;
      if (left <= 0) pendingRsvpRef.current.delete(invite.id);
      else pendingRsvpRef.current.set(invite.id, left);
    }
    if (!ok) {
      setInvites((prev) => {
        const cur = prev[invite.messageId];
        return cur && cur.myStatus === next ? { ...prev, [invite.messageId]: applyOwnRsvp(cur, previous) } : prev;
      });
    }
  }

  async function cancelInvite(invite: TrainingInviteForViewer) {
    const res = await cancelTrainingInviteAction(invite.id).catch(() => ({ ok: false as const, error: 'Das hat nicht geklappt. Bitte versuche es noch einmal.' }));
    if (!res.ok) {
      setSendError(res.error);
      return;
    }
    setInvites((prev) => (prev[invite.messageId] ? { ...prev, [invite.messageId]: { ...prev[invite.messageId]!, cancelledAt: new Date().toISOString() } } : prev));
  }

  /** Adds a page of older history in front of what is on screen, keeping the reader's place. */
  function applyOlder(res: OlderMessagesResult) {
    restoreScrollRef.current = listRef.current ? listRef.current.scrollHeight - listRef.current.scrollTop : null;
    setMessages((prev) => {
      const have = new Set(prev.map((m) => m.id));
      return [...res.messages.filter((m) => !have.has(m.id)), ...prev];
    });
    setMentionsMap((prev) => ({ ...res.mentions, ...prev }));
    setSocial((prev) => ({ ...res.social, ...prev }));
    setReactions((prev) => ({ ...res.reactions, ...prev }));
    setQuotes((prev) => ({ ...res.quotes, ...prev }));
    setShares((prev) => ({ ...res.shares, ...prev }));
    setInvites((prev) => ({ ...res.invites, ...prev }));
    setHasMore(res.hasMore);
  }

  async function loadOlder(): Promise<boolean> {
    const oldest = messagesRef.current[0];
    if (!oldest || loadingOlder) return false;
    setLoadingOlder(true);
    try {
      const res = await loadOlderMessagesAction(teamId, oldest.created_at);
      applyOlder(res);
      return res.hasMore;
    } finally {
      setLoadingOlder(false);
    }
  }

  messagesRef.current = messages;
  invitesRef.current = invites;

  /** Scroll to + briefly highlight the message a reply answers (loads older history if needed). */
  async function jumpTo(id: string) {
    let el = document.getElementById(`msg-${id}`);
    let more = hasMore;
    if (!el && more && !loadingOlder) {
      // A message far back (an old pin, an old quote): ONE request loads everything between the screen and the target
      // (bounded on the server) instead of paging sixty messages at a time. The paging loop below is the fallback.
      const oldest = messagesRef.current[0];
      if (oldest) {
        setLoadingOlder(true);
        try {
          const res = await loadMessagesUntilAction(teamId, id, oldest.created_at);
          if (res.messages.length > 0) {
            applyOlder(res);
            more = res.hasMore;
            await new Promise((r) => setTimeout(r, 80));
            el = document.getElementById(`msg-${id}`);
          }
        } catch {
          /* fall back to paging */
        } finally {
          setLoadingOlder(false);
        }
      }
    }
    for (let i = 0; !el && more && i < 8; i++) {
      more = await loadOlder();
      await new Promise((r) => setTimeout(r, 80));
      el = document.getElementById(`msg-${id}`);
    }
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightId(id);
    setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 3200);
  }

  // keep the reader's place when older messages are prepended
  useEffect(() => {
    if (restoreScrollRef.current !== null && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight - restoreScrollRef.current;
      restoreScrollRef.current = null;
    }
  }, [messages]);

  /** The pin shows the original message; this is what to show right after a successful pin (realtime then confirms it). */
  function pinPreviewOf(m: ChatMessage): PinnedMessage {
    return quoteFromMessage({ id: m.id, authorName: m.authorName, content: m.content, message_type: m.message_type, deleted_at: m.deleted_at });
  }

  async function doPin(m: ChatMessage, replace: boolean) {
    setPinBusy(true);
    setPinNotice(null);
    const res = await pinMessageAction({ messageId: m.id, replace }).catch(() => ({ ok: false as const, code: 'error' as const, error: 'Keine Verbindung. Bitte versuche es erneut.' }));
    setPinBusy(false);
    if (res.ok) {
      setPin(pinPreviewOf(m));
      setConfirmPin(null);
    } else if (res.code === 'pin_exists') {
      setConfirmPin(m); // someone pinned meanwhile: ask before replacing it
    } else {
      setConfirmPin(null);
      setPinNotice(res.error);
    }
  }

  async function doUnpin(messageId: string) {
    setPinBusy(true);
    setPinNotice(null);
    const res = await unpinMessageAction({ messageId }).catch(() => ({ ok: false as const, error: 'Keine Verbindung. Bitte versuche es erneut.' }));
    setPinBusy(false);
    if (res.ok) setPin((prev) => (prev?.id === messageId ? null : prev));
    else setPinNotice(res.error);
  }

  function togglePin(m: ChatMessage) {
    if (pinRef.current?.id === m.id) void doUnpin(m.id);
    else if (pinRef.current) setConfirmPin(m); // replacing an existing pin always asks first
    else void doPin(m, false);
  }

  /** What a team admin's menu offers for a message (nothing for anyone else, and nothing for automatic events). */
  const pinFor = (m: ChatMessage) =>
    isTeamAdmin && pinAvailable && m.message_type !== 'system' ? { pinned: pin?.id === m.id, busy: pinBusy, onToggle: () => togglePin(m) } : undefined;

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
    if (res.ok) {
      setMessages((prev) => prev.filter((m) => m.id !== id));
      setQuotes((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id]!, deleted: true } } : prev));
    }
  }

  /** Adds or removes ONE emoji for the current user, independent of any other
   * reaction they already hold on this message. On success, trust the
   * optimistic value rather than reconciling from the response — the
   * Realtime INSERT/DELETE handlers above are an idempotent,
   * eventually-consistent confirmation of whatever actually landed,
   * regardless of HTTP response timing. On failure, revert only if this
   * specific key's state still equals what THIS call set — if a newer call
   * already changed it again, don't clobber that newer state. */
  async function setReaction(messageId: string, key: ReactionKey, active: boolean) {
    updateReactions(messageId, currentUserId, key, active);
    function revert() {
      setReactions((prev) => {
        const mine = prev[messageId]?.[currentUserId] ?? [];
        if (mine.includes(key) !== active) return prev;
        return { ...prev, [messageId]: applyReactionToggle(prev[messageId] ?? {}, currentUserId, key, !active) };
      });
    }
    try {
      const res = await setReactionAction(messageId, key, active);
      if (!res.ok) revert();
    } catch {
      revert();
    }
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

  async function sendImage(caption: string, mentionUserIds: string[] = []): Promise<boolean> {
    if (!attachment) return false;
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
        replyToId: replyTo?.id ?? null,
        path,
        thumbPath,
        mime: prepared.mime,
        width: prepared.width,
        height: prepared.height,
        caption,
      });
      if (!res.ok) throw new Error(res.error);
      if (replyTo) setQuotes((prev) => ({ ...prev, [replyTo.id]: quoteFromMessage(replyTo) }));
      clearAttachment();
      return true;
    } catch {
      // Nothing was inserted (or the server removed the files); best-effort
      // cleanup of anything that did reach storage, and no broken message.
      await storage.remove([path, thumbPath]).catch(() => undefined);
      setSendError('Foto konnte nicht gesendet werden. Bitte versuche es erneut.');
      return false;
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {pinAvailable && pin && (
        <PinnedMessageStrip teamId={teamId} pin={pin} canManage={isTeamAdmin} busy={pinBusy} onView={() => void jumpTo(pin.id)} onUnpin={() => void doUnpin(pin.id)} />
      )}
      {pinNotice && (
        <p role="alert" className="shrink-0 bg-red-500/10 px-4 py-2 text-xs font-medium text-red-300">
          {pinNotice}
        </p>
      )}
      <div ref={listRef} onScroll={handleScroll} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-3 pt-4">
        {hasMore && messages.length > 0 && (
          <button
            type="button"
            onClick={loadOlder}
            disabled={loadingOlder}
            className="btn-ghost mx-auto shrink-0 !min-h-[36px] border !border-white/[0.08] bg-surface-3 px-4 text-xs"
          >
            {loadingOlder ? 'Lädt…' : 'Ältere Nachrichten laden'}
          </button>
        )}
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-neutral-400">
            <MessageCircle size={30} strokeWidth={1.6} />
            <p className="text-sm">{t('chat.empty.title')}</p>
          </div>
        ) : (
          messages.map((m, i) => {
            const mine = m.user_id === currentUserId;
            const isFormerMember = m.authorName === FORMER_MEMBER_LABEL;
            const prev = messages[i - 1];
            const showDateSeparator = !prev || !isSameLocalDay(new Date(prev.created_at), new Date(m.created_at));
            const dateLabel = showDateSeparator ? <DateSeparator label={formatChatDayLabel(new Date(m.created_at))} /> : null;

            if (m.message_type === 'system') {
              return (
                <div
                  key={m.id}
                  id={`msg-${m.id}`}
                  className={`rounded-2xl transition-shadow duration-500 ${highlightId === m.id ? 'shadow-[0_0_0_2px_rgba(0,215,245,0.55)]' : ''}`}
                >
                  {dateLabel}
                  <SystemEventCard message={m} isFirstUnread={m.id === firstUnreadId} label={t('chat.newMessages')} />
                  <EventSocial
                    social={social[m.id] ?? EMPTY_SOCIAL}
                    currentUserId={currentUserId}
                    ownerName={m.user_id === currentUserId ? 'dich selbst' : m.authorName.split(' ')[0] || m.authorName}
                    members={members}
                    onSendReply={(text, ids) => sendReply(m.id, text, ids)}
                  />
                  <ReactionChips
                    messageId={m.id}
                    currentUserId={currentUserId}
                    state={reactions[m.id]}
                    onChange={setReaction}
                    className="mx-auto mt-1.5 w-full max-w-[88%] justify-center"
                  />
                </div>
              );
            }

            // A "Wer ist dabei?" invitation renders as its own card, whoever wrote it
            // (so it comes before the creator-card branch). It has no generic edit/delete
            // menu: the card itself offers Bearbeiten / Absagen to its organizer.
            const invite = invites[m.id];
            if (invite) {
              return (
                <div
                  key={m.id}
                  id={`msg-${m.id}`}
                  className={`rounded-2xl transition-shadow duration-500 ${highlightId === m.id ? 'shadow-[0_0_0_2px_rgba(0,215,245,0.55)]' : ''}`}
                >
                  {dateLabel}
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
                      <TrainingInviteCard invite={invite} currentUserId={currentUserId} onRsvp={setRsvp} onCancel={cancelInvite} />
                      <span className="mt-0.5 px-1 text-[10px] text-neutral-400">
                        {new Date(m.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <MessageActions pin={pinFor(m)} />
                      <ReactionChips messageId={m.id} currentUserId={currentUserId} state={reactions[m.id]} onChange={setReaction} className="mt-1 px-1" />
                    </div>
                  </div>
                </div>
              );
            }

            const share = shares[m.id];

            if (isCreatorCardMessage(m, m.creatorName ? { displayName: m.creatorName } : null)) {
              return (
                <div
                  key={m.id}
                  id={`msg-${m.id}`}
                  className={`flex flex-col rounded-2xl transition-shadow duration-500 ${highlightId === m.id ? 'shadow-[0_0_0_2px_rgba(0,215,245,0.55)]' : ''}`}
                >
                  {dateLabel}
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
                    content={share ? (share.title !== m.content ? m.content : '') : m.message_type === 'image' || m.content ? m.content : ''}
                    time={new Date(m.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                    onReply={() => setReplyTo(m)}
                    quote={quoteOf(m) ? <QuoteBlock quote={quoteOf(m)!} onJump={jumpTo} /> : undefined}
                    edited={!!m.edited_at}
                    mentions={mentionsOf(m.id)}
                    currentUserId={currentUserId}
                    menu={mine || pinFor(m) ? <MessageActions onEdit={mine ? () => setEditingId(m.id) : undefined} onDelete={mine ? () => removeMessage(m.id) : undefined} pin={pinFor(m)} /> : undefined}
                    editor={
                      editingId === m.id ? (
                        <MessageEditor initial={m.content} members={members} initialMentions={mentionsOf(m.id)} onSave={(text, ids) => saveEdit(m.id, text, ids)} onCancel={() => setEditingId(null)} />
                      ) : undefined
                    }
                  >
                    {share && (
                      <SharedPlanCard
                        share={share}
                        isAuthor={mine}
                        onView={() => setViewingShare(share)}
                        onSave={() => setSavingShare(share)}
                        onWithdraw={() => withdrawShare(share.id)}
                      />
                    )}
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
                  <ReactionChips messageId={m.id} currentUserId={currentUserId} state={reactions[m.id]} onChange={setReaction} className="mt-1 px-1" />
                </div>
              );
            }

            if (share) {
              return (
                <div
                  key={m.id}
                  id={`msg-${m.id}`}
                  className={`rounded-2xl transition-shadow duration-500 ${highlightId === m.id ? 'shadow-[0_0_0_2px_rgba(0,215,245,0.55)]' : ''}`}
                >
                  {dateLabel}
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
                      {quoteOf(m) && (
                        <div className="mb-1 w-[min(84vw,340px)]">
                          <QuoteBlock quote={quoteOf(m)!} onJump={jumpTo} tone={mine ? 'own' : 'default'} />
                        </div>
                      )}
                      <SharedPlanCard
                        share={share}
                        isAuthor={mine}
                        onView={() => setViewingShare(share)}
                        onSave={() => setSavingShare(share)}
                        onWithdraw={() => withdrawShare(share.id)}
                      />
                      {share.title !== m.content && (
                        <div className="mt-1 flex items-start gap-1">
                          <MessageActions onEdit={mine ? () => setEditingId(m.id) : undefined} onDelete={mine ? () => removeMessage(m.id) : undefined} pin={pinFor(m)} />
                          <div className="min-w-0 max-w-[78vw] px-1 text-sm leading-relaxed text-neutral-600">
                            <ChatMarkdown text={m.content} tone="bubble" mentions={mentionsOf(m.id)} currentUserId={currentUserId} />
                          </div>
                        </div>
                      )}
                      <span className="mt-0.5 px-1 text-[10px] text-neutral-400">
                        {m.edited_at && <span className="mr-1 italic">bearbeitet</span>}
                        {new Date(m.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {share.title === m.content && <MessageActions pin={pinFor(m)} />}
                      <ReactionChips messageId={m.id} currentUserId={currentUserId} state={reactions[m.id]} onChange={setReaction} className="mt-1 px-1" />
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={m.id}
                id={`msg-${m.id}`}
                className={`rounded-2xl transition-shadow duration-500 ${highlightId === m.id ? 'shadow-[0_0_0_2px_rgba(0,215,245,0.55)]' : ''}`}
              >
                {dateLabel}
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
                    {quoteOf(m) && m.message_type === 'image' && !m.content && (
                      <div className="mb-1 w-[min(64vw,260px)]">
                        <QuoteBlock quote={quoteOf(m)!} onJump={jumpTo} tone={mine ? 'own' : 'default'} />
                      </div>
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
                          {mine && <MessageActions onEdit={() => setEditingId(m.id)} onDelete={() => removeMessage(m.id)} pin={pinFor(m)} />}
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
                            {quoteOf(m) && <QuoteBlock quote={quoteOf(m)!} onJump={jumpTo} tone={mine ? 'own' : 'default'} />}
                            <ChatMarkdown text={m.content} tone={mine ? 'bubble-own' : 'bubble'} mentions={mentionsOf(m.id)} currentUserId={currentUserId} />
                          </div>
                          {!mine && <MessageActions pin={pinFor(m)} />}
                        </div>
                      )
                    )}
                    <span className="mt-0.5 px-1 text-[10px] text-neutral-400">
                      {m.edited_at && <span className="mr-1 italic">bearbeitet</span>}
                      {new Date(m.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {m.message_type === 'image' && !m.content && <MessageActions pin={pinFor(m)} />}
                    <ReactionChips messageId={m.id} currentUserId={currentUserId} state={reactions[m.id]} onChange={setReaction} className="mt-1 px-1" />
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
          let sent: boolean;
          if (attachment) {
            sent = await sendImage(String(formData.get('content') || ''), ids);
          } else {
            formData.set('mentions', JSON.stringify(ids));
            try {
              const res = await sendMessageAction(formData);
              if (res.ok) {
                addPersisted(res.message, res.mentions);
                if (replyTo) setQuotes((prev) => ({ ...prev, [replyTo.id]: quoteFromMessage(replyTo) }));
                sent = true;
              } else {
                setSendError(res.error);
                sent = false;
              }
            } catch {
              setSendError('Nachricht konnte nicht gesendet werden.');
              sent = false;
            }
          }
          // A failed send keeps the draft so the user can simply retry.
          if (!sent) return;
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
          <div className="flex items-center gap-2 rounded-xl border-l-[3px] border-brand/70 bg-brand/[0.08] py-1.5 pl-2.5 pr-1">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-bold text-brand">Antwort auf {replyTo.authorName}</p>
              <p className="line-clamp-2 break-words text-xs leading-snug text-neutral-600 [overflow-wrap:anywhere]">
                {replyTo.message_type === 'image' && !replyTo.content ? 'Foto' : quotePreview(replyTo.content)}
              </p>
            </div>
            <button type="button" onClick={() => setReplyTo(null)} className="btn-icon h-7 w-7 shrink-0" aria-label="Antwort abbrechen">
              <X size={15} strokeWidth={2.25} />
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
          <button
            type="button"
            onClick={() => setPickingTemplate(true)}
            disabled={preparing || sending}
            className="btn-icon h-11 w-11 shrink-0 border border-white/[0.08] bg-surface-3 text-neutral-600"
            aria-label="Vorlage teilen"
          >
            <Layers size={19} strokeWidth={1.9} />
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

      {viewingShare && <ShareDetailSheet share={viewingShare} onClose={() => setViewingShare(null)} />}
      {savingShare && (
        <ImportShareDialog
          share={savingShare}
          onClose={() => setSavingShare(null)}
          onSaved={(templateId) => markShareSaved(savingShare.id, templateId)}
        />
      )}
      {confirmPin && (
        <Sheet title="Angeheftete Nachricht ersetzen?" onClose={() => setConfirmPin(null)}>
          <p className="text-sm text-neutral-600">Die aktuell angeheftete Nachricht wird durch diese ersetzt. Die ursprüngliche Nachricht bleibt im Chat erhalten.</p>
          <div className="mt-4 flex gap-2 pb-1">
            <button type="button" onClick={() => setConfirmPin(null)} className="btn-secondary min-h-[44px] flex-1">
              Abbrechen
            </button>
            <button type="button" disabled={pinBusy} onClick={() => void doPin(confirmPin, true)} className="btn-primary min-h-[44px] flex-1">
              {pinBusy ? 'Einen Moment…' : 'Ersetzen'}
            </button>
          </div>
        </Sheet>
      )}
      {pickingTemplate && (
        <SharePickerSheet
          teamId={teamId}
          templates={myTemplates}
          onClose={() => setPickingTemplate(false)}
          onShared={(message, share) => {
            addPersistedShare(message, share);
            setPickingTemplate(false);
          }}
        />
      )}
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

/** "Heute" / "Gestern" / "Fr., 25.09.2026" — muted, so it never competes with
 * the brand-colored "new messages" divider above. */
function DateSeparator({ label }: { label: string }) {
  return (
    <div className="my-1 flex items-center justify-center">
      <span className="rounded-full bg-surface-3 px-3 py-1 text-[11px] font-semibold text-neutral-400">{label}</span>
    </div>
  );
}
