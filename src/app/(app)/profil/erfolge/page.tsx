import { BackLink } from '@/components/ui/BackLink';
import clsx from 'clsx';
import { Medal, Flame, Timer, Target, Trophy, Dumbbell, Award, type LucideIcon } from 'lucide-react';
import { requireAuthUser } from '@/lib/data/profile';
import { getUserAchievements } from '@/lib/data/achievements';
import { formatGermanDate } from '@/lib/date';
import { t, type TranslationKey } from '@/lib/i18n';

const ACHIEVEMENT_ICONS: Record<string, LucideIcon> = {
  first_workout: Medal,
  ten_workouts: Dumbbell,
  four_week_streak: Flame,
  thousand_minutes: Timer,
  weekly_goal_reached: Target,
  challenge_completed: Trophy,
};

export default async function ErfolgePage() {
  const user = await requireAuthUser();
  const achievements = await getUserAchievements(user.id);

  return (
    <div className="screen-padding flex flex-col gap-4 pb-4">
      <div className="flex items-center gap-3">
        <BackLink href="/profil" />
        <h1 className="text-xl font-bold text-neutral-900">{t('profile.achievements')}</h1>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {achievements.map((a) => {
          const unlocked = !!a.unlockedAt;
          const Icon = ACHIEVEMENT_ICONS[a.code] ?? Award;
          return (
            <div key={a.id} className={clsx('card items-center text-center', !unlocked && 'opacity-40 grayscale')}>
              <span className={clsx('flex h-12 w-12 items-center justify-center rounded-full', unlocked ? 'bg-brand-50 text-brand' : 'bg-neutral-150 text-neutral-400')}>
                <Icon size={22} strokeWidth={1.75} />
              </span>
              <p className="mt-2 text-sm font-bold text-neutral-900">{t(a.title_key as TranslationKey)}</p>
              <p className="mt-1 text-xs text-neutral-500">{t(a.description_key as TranslationKey)}</p>
              {unlocked && <p className="mt-2 text-[10px] font-medium text-brand">{formatGermanDate(a.unlockedAt)}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
