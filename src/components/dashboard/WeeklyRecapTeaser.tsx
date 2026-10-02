import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { PersonalWeeklyRecap } from '@/types/database';

/** Small Home teaser for last week's recap. Needs no "seen" tracking: once a
 * new week passes, `ensureWeeklyRecapGenerated` targets the next week's row,
 * so this teaser is naturally superseded rather than dismissed. */
export function WeeklyRecapTeaser({ recap }: { recap: PersonalWeeklyRecap | null }) {
  if (!recap) return null;

  return (
    <Link href="/profil/rueckblick" className="card accent-gold card-accent press flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-bold text-neutral-900">Dein Wochenrückblick ist da</p>
        <p className="text-xs text-neutral-500">
          {recap.completed_workouts} {recap.completed_workouts === 1 ? 'Training' : 'Trainings'} · {recap.points} Punkte letzte Woche
        </p>
      </div>
      <ChevronRight size={18} className="shrink-0 text-neutral-400" />
    </Link>
  );
}
