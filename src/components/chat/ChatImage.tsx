'use client';

import { useEffect, useState } from 'react';
import { ImageOff, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

/** Private-bucket image: a short-lived signed URL is requested lazily (thumb
 * for the bubble, full size only when opened). Aspect ratio is reserved from
 * the stored dimensions so nothing jumps while loading. */
export function ChatImage({
  path,
  thumbPath,
  width,
  height,
}: {
  path: string;
  thumbPath: string | null;
  width: number | null;
  height: number | null;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .storage.from('chat-media')
      .createSignedUrl(thumbPath ?? path, 3600)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) setFailed(true);
        else setThumbUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [path, thumbPath]);

  async function openFull() {
    setOpen(true);
    if (fullUrl) return;
    const { data } = await createClient().storage.from('chat-media').createSignedUrl(path, 3600);
    setFullUrl(data?.signedUrl ?? thumbUrl);
  }

  const ratio = width && height ? `${width} / ${height}` : '4 / 3';

  return (
    <>
      <button
        type="button"
        onClick={openFull}
        style={{ aspectRatio: ratio }}
        className="relative block w-[min(64vw,260px)] overflow-hidden rounded-2xl bg-neutral-150"
        aria-label="Bild vergrößern"
      >
        {failed ? (
          <span className="flex h-full w-full items-center justify-center text-neutral-400">
            <ImageOff size={22} />
          </span>
        ) : thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbUrl} alt="Foto im Team-Chat" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="absolute inset-0 animate-pulse bg-neutral-200/40" />
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3"
          style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))', paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            className="btn-icon absolute right-3 h-10 w-10 bg-white/10 text-white"
            style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
            onClick={() => setOpen(false)}
            aria-label="Schließen"
          >
            <X size={20} />
          </button>
          {fullUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fullUrl} alt="Foto im Team-Chat" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-sm text-white/70">Lädt…</span>
          )}
        </div>
      )}
    </>
  );
}
