import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireAuthUser } from '@/lib/data/profile';
import { updateMetricPreferencesAction } from '../actions';
import { t } from '@/lib/i18n';
import type { UserMetricPreferences } from '@/types/database';

const METRICS = ['calories', 'protein', 'carbs', 'fat', 'water', 'steps', 'sleep', 'bmi', 'restingHeartRate'] as const;
const METRIC_KEYS: Record<(typeof METRICS)[number], string> = {
  calories: 'calories', protein: 'protein', carbs: 'carbs', fat: 'fat', water: 'water',
  steps: 'steps', sleep: 'sleep', bmi: 'bmi', restingHeartRate: 'resting_heart_rate',
};

export default async function MetrikenPage() {
  const user = await requireAuthUser();
  const supabase = await createClient();
  const { data } = await supabase.from('user_metric_preferences').select('*').eq('user_id', user.id).single();
  const prefs = data as UserMetricPreferences;
  const enabled = new Set(prefs?.enabled_metrics ?? []);

  return (
    <div className="screen-padding flex flex-col gap-4 pb-8">
      <div className="flex items-center gap-3">
        <Link href="/profil" className="text-2xl text-neutral-400">‹</Link>
        <h1 className="text-xl font-bold text-neutral-900">{t('metric.manage')}</h1>
      </div>
      <p className="text-xs text-neutral-500">{t('metric.manage.description')}</p>

      <form action={updateMetricPreferencesAction} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2">
          {METRICS.map((m) => (
            <label key={m} className="card flex items-center gap-2 py-3">
              <input type="checkbox" name="enabledMetrics" value={METRIC_KEYS[m]} defaultChecked={enabled.has(METRIC_KEYS[m])} className="h-5 w-5 accent-brand" />
              <span className="text-sm font-medium text-neutral-800">{t(`metric.${m}` as const)}</span>
            </label>
          ))}
        </div>

        <div>
          <label className="label" htmlFor="stepsGoal">{t('metric.steps')} – Tagesziel</label>
          <input id="stepsGoal" name="stepsGoal" type="number" defaultValue={prefs?.steps_goal ?? 10000} className="input-field" />
        </div>
        <div>
          <label className="label" htmlFor="calorieGoal">{t('metric.calories')} – Tagesziel ({t('common.optional')})</label>
          <input id="calorieGoal" name="calorieGoal" type="number" defaultValue={prefs?.calorie_goal_kcal ?? ''} className="input-field" />
        </div>

        <button type="submit" className="btn-primary">{t('common.saveChanges')}</button>
      </form>
    </div>
  );
}
