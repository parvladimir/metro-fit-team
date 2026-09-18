import { redirect } from 'next/navigation';
import { requireAuthUser, getCurrentProfile, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getUnreadChatCount } from '@/lib/data/chat';
import { BottomNav } from '@/components/nav/BottomNav';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuthUser();
  const profile = await getCurrentProfile();

  if (profile && !profile.onboarding_completed_at) {
    redirect('/onboarding');
  }

  const membership = await getPrimaryTeamMembership(user.id);
  const unreadChatCount = membership ? await getUnreadChatCount(membership.team_id) : 0;

  return (
    <div className="app-shell">
      <main className="flex min-h-0 flex-1 flex-col pb-6">{children}</main>
      <InstallPrompt />
      <BottomNav teamId={membership?.team_id ?? null} initialUnreadCount={unreadChatCount} />
    </div>
  );
}
