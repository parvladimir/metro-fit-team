import { redirect } from 'next/navigation';
import { requireAuthUser, getCurrentProfile } from '@/lib/data/profile';
import { BottomNav } from '@/components/nav/BottomNav';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireAuthUser();
  const profile = await getCurrentProfile();

  if (profile && !profile.onboarding_completed_at) {
    redirect('/onboarding');
  }

  return (
    <div className="app-shell">
      <main className="flex-1 pb-6">{children}</main>
      <InstallPrompt />
      <BottomNav />
    </div>
  );
}
