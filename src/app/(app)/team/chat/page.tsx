import { MessageCircle } from 'lucide-react';
import { BackLink } from '@/components/ui/BackLink';
import { requireAuthUser, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getRecentMessages, getChatLastReadAt } from '@/lib/data/chat';
import { ChatRoom } from '@/components/chat/ChatRoom';
import { ChatPushPrompt } from '@/components/chat/ChatPushPrompt';
import { EmptyState } from '@/components/ui/EmptyState';
import { t } from '@/lib/i18n';

export default async function ChatPage() {
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

  return (
    <div className="-mb-6 flex h-full min-h-0 flex-1 flex-col">
      <div
        className="flex shrink-0 items-center gap-3 border-b border-neutral-200 bg-neutral-100 px-4 pb-3"
        style={{ paddingTop: 'max(0.75rem, calc(env(safe-area-inset-top) + 0.5rem))' }}
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
      />
    </div>
  );
}
