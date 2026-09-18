import { redirect } from 'next/navigation';
import { requireAuthUser, getCurrentProfile, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getUnreadChatCount, getUnreadNotificationCount } from '@/lib/data/chat';
import { NotificationSync } from '@/components/notifications/NotificationSync';
import { BottomNav } from '@/components/nav/BottomNav';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuthUser();
  const profile = await getCurrentProfile();

  if (profile && !profile.onboarding_completed_at) {
    redirect('/onboarding');
  }

  const membership = await getPrimaryTeamMembership(user.id);
  const [unreadChatCount, notificationCount] = await Promise.all([
    membership ? getUnreadChatCount(membership.team_id) : Promise.resolve(0),
    getUnreadNotificationCount(user.id),
  ]);

  return (
    <div className="app-shell">
      <main className="flex min-h-0 flex-1 flex-col pb-6">{children}</main>
      <NotificationSync userId={user.id} initialCount={notificationCount} />
      <InstallPrompt />
      <BottomNav teamId={membership?.team_id ?? null} initialUnreadCount={unreadChatCount} />
    </div>
  );
}
