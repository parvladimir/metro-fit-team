import { redirect } from 'next/navigation';
import { requireAuthUser, getCurrentProfile, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getUnreadChatCount, getUnreadNotificationCount } from '@/lib/data/chat';
import { getActiveWorkout } from '@/lib/data/workouts';
import { NotificationSync } from '@/components/notifications/NotificationSync';
import { BottomNav } from '@/components/nav/BottomNav';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { RunningWorkoutStrip } from '@/components/workout/RunningWorkoutStrip';
import { DraftSweeper } from '@/components/workout/DraftHousekeeping';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuthUser();
  const profile = await getCurrentProfile();

  if (profile && !profile.onboarding_completed_at) {
    redirect('/onboarding');
  }

  const membership = await getPrimaryTeamMembership(user.id);
  const [unreadChatCount, notificationCount, activeWorkout] = await Promise.all([
    membership ? getUnreadChatCount(membership.team_id) : Promise.resolve(0),
    getUnreadNotificationCount(user.id),
    getActiveWorkout(user.id),
  ]);

  return (
    <div className="app-shell">
      <main className="flex min-h-0 flex-1 flex-col pb-6">{children}</main>
      <NotificationSync userId={user.id} initialCount={notificationCount} />
      <InstallPrompt />
      <DraftSweeper userId={user.id} activeWorkoutId={activeWorkout?.id ?? null} />
      <RunningWorkoutStrip workout={activeWorkout} />
      <BottomNav teamId={membership?.team_id ?? null} initialUnreadCount={unreadChatCount} />
    </div>
  );
}
