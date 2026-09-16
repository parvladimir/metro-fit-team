import Link from 'next/link';

export function EmptyState({
  title,
  actionLabel,
  actionHref,
  icon = '📋',
}: {
  title: string;
  actionLabel?: string;
  actionHref?: string;
  icon?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-200 bg-white px-6 py-10 text-center">
      <span className="text-3xl">{icon}</span>
      <p className="text-sm font-medium text-neutral-500">{title}</p>
      {actionLabel && actionHref && (
        <Link href={actionHref} className="btn-primary px-5 py-2.5 text-sm">
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
