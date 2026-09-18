import Link from 'next/link';
import { TrendingUp, Award, BarChart3, Lock, Settings, Wrench, ChevronRight, type LucideIcon } from 'lucide-react';
import { getCurrentProfile, getPrimaryTeamMembership } from '@/lib/data/profile';
import { getProfileStats } from '@/lib/data/stats';
import { signOutAction } from '@/app/(auth)/actions';
import { Avatar } from '@/components/ui/Avatar';
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
      <Link href="/profil/bearbeiten" className="flex items-center gap-4">
        <Avatar src={profile.avatar_url} name={profile.full_name} size="lg" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-neutral-900">{profile.full_name}</h1>
          {profile.fitness_goal && (
            <p className="text-sm text-neutral-500">{t(`onboarding.goal.${profile.fitness_goal}` as const)}</p>
          )}
          <p className="mt-0.5 text-xs font-semibold text-brand">{t('profile.editProfile')} ›</p>
        </div>
      </Link>

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
        <MenuLink href="/profil/fortschritt" icon={TrendingUp} label={t('chart.progress.title')} />
        <MenuLink href="/profil/erfolge" icon={Award} label={t('profile.achievements')} />
        <MenuLink href="/profil/metriken" icon={BarChart3} label={t('metric.manage')} />
        <MenuLink href="/profil/datenschutz" icon={Lock} label={t('profile.privacySettings')} />
        <MenuLink href="/profil/einstellungen" icon={Settings} label={t('profile.appSettings')} />
        {membership?.role === 'team_admin' && <MenuLink href="/team/verwalten" icon={Wrench} label={t('profile.teamManagement')} />}
      </div>

      <form action={signOutAction}>
        <button type="submit" className="btn-ghost w-full bg-neutral-100 text-neutral-700">{t('auth.signOut')}</button>
      </form>

      <footer className="pb-safe-b pt-2 text-center text-xs text-neutral-500">
        <p>{t('profile.footer.credit')}</p>
        <p className="mt-2">
          {t('profile.footer.contact')}
          <br />
          <a href="mailto:v.paryacool@gmail.com" className="text-neutral-400 underline underline-offset-2">
            v.paryacool@gmail.com
          </a>
        </p>
      </footer>
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

function MenuLink({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <Link href={href} className="card flex items-center gap-3 py-3.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-150 text-neutral-500">
        <Icon size={18} strokeWidth={1.9} />
      </span>
      <span className="flex-1 text-sm font-semibold text-neutral-900">{label}</span>
      <ChevronRight size={18} className="shrink-0 text-neutral-300" />
    </Link>
  );
}
