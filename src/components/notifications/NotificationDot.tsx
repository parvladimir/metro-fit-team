'use client';

import { useNotificationCount } from '@/lib/notification-store';

/** Small count pill for personal reaction/reply notifications (not chat unread). */
export function NotificationCount({ initial }: { initial: number }) {
  const n = useNotificationCount(initial);
  if (n <= 0) return null;
  return (
    <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold leading-none text-[#00232A]">
      {n > 9 ? '9+' : n}
    </span>
  );
}
