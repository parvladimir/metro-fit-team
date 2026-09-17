import { redirect } from 'next/navigation';
import { requireAuthUser, getCurrentProfile } from '@/lib/data/profile';
import { OnboardingForm } from './OnboardingForm';

export default async function OnboardingPage() {
  const user = await requireAuthUser();
  const profile = await getCurrentProfile();

  if (profile?.onboarding_completed_at) {
    redirect('/');
  }

  return (
    <div
      className="mx-auto min-h-screen w-full max-w-app px-5 pb-8"
      style={{ paddingTop: 'max(2rem, calc(env(safe-area-inset-top) + 1rem))' }}
    >
      <OnboardingForm userId={user.id} defaultFullName={profile?.full_name || ''} />
    </div>
  );
}
