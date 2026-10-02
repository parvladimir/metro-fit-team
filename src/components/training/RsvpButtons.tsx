'use client';

import clsx from 'clsx';
import { Check, CircleQuestionMark } from 'lucide-react';
import type { RsvpStatus } from '@/lib/training-invites';

const OPTIONS = [
  { value: 'going', label: 'Dabei', Icon: Check },
  { value: 'maybe', label: 'Vielleicht', Icon: CircleQuestionMark },
] as const;

/** "Dabei" / "Vielleicht" as two toggle buttons. Tapping the one that is
 * already active withdraws the answer, so an answer is always changeable and
 * removable. Both targets are the app's standard 46px buttons, state is
 * exposed with aria-pressed (not colour alone), and focus is always visible. */
export function RsvpButtons({
  status,
  onChange,
  disabled = false,
}: {
  status: RsvpStatus | null;
  onChange: (next: RsvpStatus | null) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label="Deine Antwort" className="grid grid-cols-2 gap-2">
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = status === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(active ? null : value)}
            className={clsx(
              active ? 'btn-primary' : 'btn-secondary',
              'w-full text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
            )}
          >
            <Icon size={16} strokeWidth={2.25} aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
