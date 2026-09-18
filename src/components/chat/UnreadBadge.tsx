'use client';

import { useUnreadCount } from '@/lib/unread-store';

/** Small cyan count pill, driven by the shared unread store. */
export function UnreadBadge({ initial }: { initial: number }) {
  const count = useUnreadCount(initial);
  if (count <= 0) return null;
  return (
    <span className="ml-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold leading-none text-[#00232A]">
      {count > 9 ? '9+' : count}
    </span>
  );
}
