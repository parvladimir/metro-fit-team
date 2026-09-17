import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import { BackLink } from '@/components/ui/BackLink';
import { requireAuthUser, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getRecentMessages } from '@/lib/data/chat';
import { ChatRoom } from '@/components/chat/ChatRoom';
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

  const messages = await getRecentMessages(membership.team_id);

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col">
      <div className="flex items-center gap-3 border-b border-neutral-200 bg-neutral-100 px-4 py-3">
        <BackLink href="/team" />
        <h1 className="text-lg font-bold text-neutral-900">{membership.team_name}</h1>
      </div>
      <ChatRoom teamId={membership.team_id} currentUserId={user.id} initialMessages={messages} />
    </div>
  );
}
