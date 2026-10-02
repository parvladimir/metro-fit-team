import Link from 'next/link';
import { CalendarPlus, MessageCircle } from 'lucide-react';
import { BackLink } from '@/components/ui/BackLink';
import { requireAuthUser, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getMessagesPage, getChatLastReadAt, getEventReplies, getMessageReactions, getMentionMembers, getMessageMentions, getQuotes } from '@/lib/data/chat';
import { getPlanSharesForViewer } from '@/lib/data/plan-shares';
import { getTrainingInvitesForViewer } from '@/lib/data/training-invites';
import { getTeamPin } from '@/lib/data/chat-pin';
import { getTemplates } from '@/lib/data/plan-templates';
import { isValidMessageId } from '@/lib/event-social';
import { ChatRoom } from '@/components/chat/ChatRoom';
import { ChatPushPrompt } from '@/components/chat/ChatPushPrompt';
import { EmptyState } from '@/components/ui/EmptyState';
import { t } from '@/lib/i18n';

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { message } = await searchParams;
  const user = await requireAuthUser();
  const membership = await getPrimaryTeamMembership(user.id);

  if (!membership) {
    return (
      <div className="screen-padding pb-4">
        <EmptyState title={t('team.noTeam.title')} icon={MessageCircle} />
      </div>
    );
  }

  const [{ messages, hasMore }, previousReadAt] = await Promise.all([
    getMessagesPage(membership.team_id),
    getChatLastReadAt(membership.team_id, user.id),
  ]);

  const [social, reactions, members, mentions, quotes, shares, invites, myTemplates, pinLoad] = await Promise.all([
    getEventReplies(messages.filter((m) => m.message_type === 'system').map((m) => m.id)),
    getMessageReactions(messages.map((m) => m.id)),
    getMentionMembers(membership.team_id, user.id),
    getMessageMentions(messages.filter((m) => m.message_type !== 'system').map((m) => m.id)),
    getQuotes(messages),
    getPlanSharesForViewer(messages.map((m) => m.id), user.id),
    getTrainingInvitesForViewer(messages.map((m) => m.id), user.id),
    getTemplates(user.id),
    getTeamPin(membership.team_id),
  ]);

  return (
    <div className="-mb-6 flex h-full min-h-0 flex-1 flex-col">
      <div
        className="flex shrink-0 items-center gap-3 border-b border-white/[0.08] bg-surface-2 px-4 pb-3 shadow-[0_8px_20px_-14px_rgba(0,0,0,0.7)]"
        // Safe-area inset + extra breathing room so the header never sits tight under the status bar / Dynamic Island.
        style={{ paddingTop: 'max(1rem, calc(env(safe-area-inset-top) + 1rem))' }}
      >
        <BackLink href="/team" />
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-neutral-900">{membership.team_name}</h1>
        <Link
          href="/team/training/neu"
          aria-label="Gemeinsames Training planen"
          className="btn-icon h-11 w-11 shrink-0 border border-white/[0.08] bg-surface-3 text-neutral-600"
        >
          <CalendarPlus size={20} strokeWidth={1.9} />
        </Link>
      </div>
      <ChatPushPrompt />
      <ChatRoom
        teamId={membership.team_id}
        currentUserId={user.id}
        initialMessages={messages}
        previousReadAt={previousReadAt}
        initialSocial={social}
        initialReactions={reactions}
        members={members}
        initialMentions={mentions}
        initialHasMore={hasMore}
        initialQuotes={quotes}
        initialShares={shares}
        initialInvites={invites}
        myTemplates={myTemplates}
        isTeamAdmin={membership.role === 'team_admin'}
        initialPin={pinLoad.status === 'ok' ? pinLoad.pin : null}
        // Until the database has the pin table (a separate, later step) there is no strip and no "Anheften".
        pinAvailable={pinLoad.status !== 'unavailable'}
        focusMessageId={isValidMessageId(message) ? message : null}
      />
    </div>
  );
}
