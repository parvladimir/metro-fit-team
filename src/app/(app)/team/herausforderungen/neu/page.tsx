import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAuthUser, getPrimaryTeamMembership } from '@/lib/data/profile';
import { createChallengeAction } from '../actions';
import { t } from '@/lib/i18n';
import type { ChallengeMetric } from '@/types/database';

const METRICS: ChallengeMetric[] = ['workouts_count', 'minutes', 'steps', 'distance_km', 'strength_sessions', 'custom'];

export default async function NeueHerausforderungPage() {
  const user = await requireAuthUser();
  const membership = await getPrimaryTeamMembership(user.id);
  if (!membership || membership.role !== 'team_admin') redirect('/team/herausforderungen');

  const today = new Date().toISOString().slice(0, 10);
  const inTwoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return (
    <div className="screen-padding flex flex-col gap-5 pb-8">
      <div className="flex items-center gap-3">
        <Link href="/team/herausforderungen" className="text-2xl text-neutral-400">‹</Link>
        <h1 className="text-xl font-bold text-neutral-900">{t('challenge.create')}</h1>
      </div>

      <form action={createChallengeAction} className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="title">{t('challenge.name')}</label>
          <input id="title" name="title" required className="input-field" placeholder="4 Trainings diese Woche" />
        </div>
        <div>
          <label className="label" htmlFor="description">{t('challenge.description')} ({t('common.optional')})</label>
          <textarea id="description" name="description" rows={2} className="input-field" />
        </div>

        <div>
          <span className="label">{t('challenge.type.individual')} / {t('challenge.type.team')}</span>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-50">
              <input type="radio" name="challengeType" value="individual" defaultChecked className="accent-brand" />
              {t('challenge.type.individual')}
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-50">
              <input type="radio" name="challengeType" value="team" className="accent-brand" />
              {t('challenge.type.team')}
            </label>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="metric">{t('challenge.metric.custom')}</label>
          <select id="metric" name="metric" defaultValue={METRICS[0]} className="input-field">
            {METRICS.map((m) => (
              <option key={m} value={m}>{t(`challenge.metric.${m}` as const)}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="targetValue">{t('challenge.target')}</label>
            <input id="targetValue" name="targetValue" type="number" min={1} required className="input-field" />
          </div>
          <div>
            <label className="label" htmlFor="pointsReward">{t('challenge.pointsReward')}</label>
            <input id="pointsReward" name="pointsReward" type="number" min={0} defaultValue={100} className="input-field" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="startsAt">{t('challenge.startsAt')}</label>
            <input id="startsAt" name="startsAt" type="date" defaultValue={today} required className="input-field" />
          </div>
          <div>
            <label className="label" htmlFor="endsAt">{t('challenge.endsAt')}</label>
            <input id="endsAt" name="endsAt" type="date" defaultValue={inTwoWeeks} required className="input-field" />
          </div>
        </div>

        <button type="submit" className="btn-primary">{t('common.save')}</button>
      </form>
    </div>
  );
}
