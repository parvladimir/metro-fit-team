import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { JoinTeamCard } from './JoinTeamCard';
import { appConfig } from '@/lib/config';

export default async function BeitretenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/anmelden?next=/beitreten/${token}`);
  }

  const { data } = await supabase.rpc('preview_team_invite', { p_token: token });
  const preview = (Array.isArray(data) ? data[0] : data) as { team_name: string | null; valid: boolean } | null;

  return (
    <div
      className="mx-auto flex min-h-screen w-full max-w-app flex-col justify-center px-6 pb-10"
      style={{ paddingTop: 'max(2.5rem, calc(env(safe-area-inset-top) + 1rem))' }}
    >
      <div className="mb-8 flex flex-col items-center gap-2 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-2xl font-black text-[#00232A]">
          {appConfig.name.charAt(0)}
        </div>
      </div>
      <JoinTeamCard token={token} teamName={preview?.team_name ?? null} valid={preview?.valid ?? false} />
    </div>
  );
}
