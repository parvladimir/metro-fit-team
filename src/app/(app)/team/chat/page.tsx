import Link from 'next/link';
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
        <EmptyState title={t('team.noTeam.title')} icon="💬" />
      </div>
    );
  }

  const messages = await getRecentMessages(membership.team_id);

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col">
      <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3">
        <Link href="/team" className="text-2xl text-neutral-400">‹</Link>
        <h1 className="text-lg font-bold text-neutral-900">{membership.team_name}</h1>
      </div>
      <ChatRoom teamId={membership.team_id} currentUserId={user.id} initialMessages={messages} />
    </div>
  );
}
