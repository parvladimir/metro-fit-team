import Link from 'next/link';
import { Lock } from 'lucide-react';
import { BackLink } from '@/components/ui/BackLink';
import { addMeasurementAction } from '../../actions';
import { MEASUREMENT_FIELDS } from '@/lib/data/measurements';
import { t } from '@/lib/i18n';

export default function NeueMessungPage() {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="screen-padding flex flex-col gap-5 pb-8">
      <div className="flex items-center gap-3">
        <BackLink href="/aktivitaet?tab=messungen" />
        <h1 className="text-xl font-bold text-neutral-900">{t('measurement.add')}</h1>
      </div>

      <p className="flex items-center gap-1.5 rounded-xl bg-neutral-100 px-4 py-3 text-xs text-neutral-500">
        <Lock size={13} strokeWidth={2} className="shrink-0" />
        {t('measurement.private.notice')}
      </p>

      <form action={addMeasurementAction} className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="measuredAt">{t('measurement.date')}</label>
          <input id="measuredAt" name="measuredAt" type="date" defaultValue={today} max={today} required className="input-field" />
        </div>

        {MEASUREMENT_FIELDS.map((field) => (
          <div key={field.key}>
            <label className="label" htmlFor={field.key}>
              {t(field.labelKey as Parameters<typeof t>[0])} ({field.unit})
            </label>
            <input id={field.key} name={field.key} type="number" step="0.1" inputMode="decimal" className="input-field" />
          </div>
        ))}

        <div>
          <label className="label" htmlFor="notes">{t('workout.notes')} ({t('common.optional')})</label>
          <textarea id="notes" name="notes" rows={2} className="input-field" />
        </div>

        <button type="submit" className="btn-primary">{t('common.save')}</button>
      </form>
    </div>
  );
}
