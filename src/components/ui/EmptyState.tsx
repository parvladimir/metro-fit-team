import Link from 'next/link';
import { ClipboardList, type LucideIcon } from 'lucide-react';

export function EmptyState({
  title,
  actionLabel,
  actionHref,
  icon: Icon = ClipboardList,
}: {
  title: string;
  actionLabel?: string;
  actionHref?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-200 bg-neutral-100 px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-150 text-neutral-400">
        <Icon size={22} strokeWidth={1.75} />
      </span>
      <p className="text-sm font-medium text-neutral-500">{title}</p>
      {actionLabel && actionHref && (
        <Link href={actionHref} className="btn-primary px-5 py-2.5 text-sm">
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
