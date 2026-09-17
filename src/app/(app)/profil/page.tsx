import Link from 'next/link';
import { getCurrentProfile, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getProfileStats } from '@/lib/data/stats';
import { signOutAction } from '@/app/(auth)/actions';
import { t } from '@/lib/i18n';

export default async function ProfilPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const [membership, stats] = await Promise.all([
    getPrimaryTeamMembership(profile.id),
    getProfileStats(profile.id),
  ]);

  return (
    <div className="screen-padding flex flex-col gap-5 pb-4">
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-neutral-200 text-2xl font-bold text-neutral-600">
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            (profile.full_name || '?').charAt(0)
          )}
        </div>
        <div>
          <h1 className="text-xl font-bold text-neutral-900">{profile.full_name}</h1>
          {profile.fitness_goal && (
            <p className="text-sm text-neutral-500">{t(`onboarding.goal.${profile.fitness_goal}` as const)}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label={t('profile.weeklyGoal')} value={`${profile.weekly_goal}`} />
        <StatCard label={t('profile.streak')} value={t('profile.streakWeeks', { weeks: stats.streakWeeks })} />
        <StatCard label={t('profile.totalWorkouts')} value={`${stats.totalWorkouts}`} />
      </div>

      {membership && (
        <div className="card flex items-center justify-between">
          <div>
            <p className="section-title">{t('profile.team')}</p>
            <p className="text-base font-semibold text-neutral-900">{membership.team_name}</p>
          </div>
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-600">
            {t(`admin.role.${membership.role}` as const)}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <MenuLink href="/profil/fortschritt" icon="📈" label={t('chart.progress.title')} />
        <MenuLink href="/profil/erfolge" icon="🏅" label={t('profile.achievements')} />
        <MenuLink href="/profil/metriken" icon="📊" label={t('metric.manage')} />
        <MenuLink href="/profil/datenschutz" icon="🔒" label={t('profile.privacySettings')} />
        <MenuLink href="/profil/einstellungen" icon="⚙️" label={t('profile.appSettings')} />
        {membership?.role === 'team_admin' && <MenuLink href="/team/verwalten" icon="🛠️" label={t('profile.teamManagement')} />}
      </div>

      <form action={signOutAction}>
        <button type="submit" className="btn-ghost w-full bg-neutral-100 text-neutral-700">{t('auth.signOut')}</button>
      </form>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card items-center py-3">
      <p className="text-lg font-extrabold text-neutral-900">{value}</p>
      <p className="mt-0.5 text-center text-[11px] font-medium text-neutral-500">{label}</p>
    </div>
  );
}

function MenuLink({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <Link href={href} className="card flex items-center gap-3 py-3.5">
      <span className="text-lg">{icon}</span>
      <span className="flex-1 text-sm font-semibold text-neutral-900">{label}</span>
      <span className="text-neutral-300">›</span>
    </Link>
  );
}
