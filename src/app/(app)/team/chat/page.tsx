import { MessageCircle } from 'lucide-react';
import { BackLink } from '@/components/ui/BackLink';
import { requireAuthUser, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getRecentMessages, getChatLastReadAt, getEventSocial, getMentionMembers, getMessageMentions } from '@/lib/data/chat';
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

  const [messages, previousReadAt] = await Promise.all([
    getRecentMessages(membership.team_id),
    getChatLastReadAt(membership.team_id, user.id),
  ]);

  const [social, members, mentions] = await Promise.all([
    getEventSocial(messages.filter((m) => m.message_type === 'system').map((m) => m.id)),
    getMentionMembers(membership.team_id, user.id),
    getMessageMentions(messages.filter((m) => m.message_type !== 'system').map((m) => m.id)),
  ]);

  return (
    <div className="-mb-6 flex h-full min-h-0 flex-1 flex-col">
      <div
        className="flex shrink-0 items-center gap-3 border-b border-neutral-200 bg-neutral-100 px-4 pb-3"
        // Safe-area inset + extra breathing room so the header never sits tight under the status bar / Dynamic Island.
        style={{ paddingTop: 'max(1rem, calc(env(safe-area-inset-top) + 1rem))' }}
      >
        <BackLink href="/team" />
        <h1 className="min-w-0 truncate text-lg font-bold text-neutral-900">{membership.team_name}</h1>
      </div>
      <ChatPushPrompt />
      <ChatRoom
        teamId={membership.team_id}
        currentUserId={user.id}
        initialMessages={messages}
        previousReadAt={previousReadAt}
        initialSocial={social}
        members={members}
        initialMentions={mentions}
        focusMessageId={isValidMessageId(message) ? message : null}
      />
    </div>
  );
}
