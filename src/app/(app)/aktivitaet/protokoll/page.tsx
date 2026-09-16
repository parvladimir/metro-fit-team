import Link from 'next/link';
import { logActivityAction } from '../actions';
import { t } from '@/lib/i18n';
import type { ActivityType } from '@/types/database';

const TYPES: ActivityType[] = ['laufen', 'gehen', 'radfahren', 'schwimmen', 'fussball', 'fitnesskurs', 'sonstiges'];

export default function ProtokollPage() {
  return (
    <div className="screen-padding flex flex-col gap-5 pb-8">
      <div className="flex items-center gap-3">
        <Link href="/aktivitaet" className="text-2xl text-neutral-400">‹</Link>
        <h1 className="text-xl font-bold text-neutral-900">{t('workout.log.title')}</h1>
      </div>

      <form action={logActivityAction} className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="activityType">{t('workout.selectType')}</label>
          <select id="activityType" name="activityType" defaultValue={TYPES[0]} className="input-field">
            {TYPES.map((type) => (
              <option key={type} value={type}>{t(`activityType.${type}` as const)}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="durationMinutes">{t('workout.duration')} ({t('common.minutes')})</label>
            <input id="durationMinutes" name="durationMinutes" type="number" inputMode="numeric" className="input-field" />
          </div>
          <div>
            <label className="label" htmlFor="distanceKm">{t('workout.distance')} (km)</label>
            <input id="distanceKm" name="distanceKm" type="number" step="0.1" inputMode="decimal" className="input-field" />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="steps">{t('metric.steps')} ({t('common.optional')})</label>
          <input id="steps" name="steps" type="number" inputMode="numeric" className="input-field" />
        </div>

        <div>
          <label className="label" htmlFor="notes">{t('workout.notes')}</label>
          <textarea id="notes" name="notes" rows={2} className="input-field" />
        </div>

        <button type="submit" className="btn-primary">{t('common.save')}</button>
      </form>
    </div>
  );
}
