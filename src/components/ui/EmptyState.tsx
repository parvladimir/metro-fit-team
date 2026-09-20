import Link from 'next/link';
import { ClipboardList, type LucideIcon } from 'lucide-react';

export function EmptyState({
  title,
  actionLabel,
  actionHref,
  icon: Icon = ClipboardList,
  accent = 'primary',
}: {
  title: string;
  actionLabel?: string;
  actionHref?: string;
  icon?: LucideIcon;
  /** subtle semantic tint for the icon chip */
  accent?: 'primary' | 'team' | 'challenge' | 'gold' | 'success';
}) {
  return (
    <div className={`accent-${accent} flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-300/70 bg-surface-1 px-6 py-10 text-center`}>
      <span className="icon-chip h-12 w-12">
        <Icon size={22} strokeWidth={1.85} />
      </span>
      <p className="text-sm font-medium text-neutral-600">{title}</p>
      {actionLabel && actionHref && (
        <Link href={actionHref} className="btn-primary px-5 py-2.5 text-sm">
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
