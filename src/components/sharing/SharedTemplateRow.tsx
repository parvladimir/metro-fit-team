'use client';

import { useState } from 'react';
import { CheckCircle2, ChevronRight, Dumbbell } from 'lucide-react';
import { ShareDetailSheet } from '@/components/sharing/ShareDetailSheet';
import { shareExerciseSummary, shareKindLabel } from '@/lib/plan-shares';
import { formatGermanDateShort } from '@/lib/date';
import type { TeamShareListItem } from '@/lib/data/plan-shares';

/** One row in "Geteilte Vorlagen" — tapping it opens the same detail sheet
 * (with its own "Als Vorlage speichern") the chat card uses. */
export function SharedTemplateRow({ share }: { share: TeamShareListItem }) {
  const [viewing, setViewing] = useState(false);
  const summary = shareExerciseSummary(share.items);
  const Icon = share.source_type === 'workout' ? CheckCircle2 : Dumbbell;

  return (
    <>
      <button type="button" onClick={() => setViewing(true)} className="card flex items-start gap-3 !py-3.5 text-left">
        <span className="icon-chip accent-primary h-11 w-11 shrink-0">
          <Icon size={19} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold text-neutral-900">{share.title}</p>
          <p className="text-xs text-neutral-500">
            {shareKindLabel(share.source_type)} · {share.items.length} {share.items.length === 1 ? 'Übung' : 'Übungen'} · von {share.authorName}
          </p>
          {summary && <p className="mt-1 break-words text-sm text-neutral-400">{summary}</p>}
          <p className="mt-1 text-[11px] text-neutral-500">
            Geteilt am {formatGermanDateShort(share.created_at)}
            {share.savedTemplateId && ' · Bereits gespeichert'}
          </p>
        </div>
        <ChevronRight size={16} className="mt-1 shrink-0 text-neutral-400" />
      </button>

      {viewing && <ShareDetailSheet share={share} onClose={() => setViewing(false)} />}
    </>
  );
}
