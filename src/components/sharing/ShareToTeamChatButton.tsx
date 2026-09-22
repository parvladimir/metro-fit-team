'use client';

import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { SharePreviewSheet, type SharePreviewSource } from '@/components/sharing/SharePreviewSheet';

/** "Im Team-Chat teilen" — compact entry point reused on the template list,
 * a configured Plan day, and a completed workout's detail page. */
export function ShareToTeamChatButton({
  teamId,
  source,
  className = 'btn-ghost bg-neutral-150 px-4 text-sm text-brand',
  iconOnly = false,
}: {
  teamId: string | null;
  source: SharePreviewSource;
  className?: string;
  /** Icon-only variant for a tight action stack (e.g. next to Umbenennen/Duplizieren). */
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!teamId) return null;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Im Team-Chat teilen" className={className}>
        <Share2 size={16} strokeWidth={2} />
        {!iconOnly && 'Im Team-Chat teilen'}
      </button>
      {open && <SharePreviewSheet teamId={teamId} source={source} onClose={() => setOpen(false)} />}
    </>
  );
}
