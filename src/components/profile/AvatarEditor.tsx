'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Avatar } from '@/components/ui/Avatar';
import { t } from '@/lib/i18n';

const MAX_SOURCE_BYTES = 15 * 1024 * 1024; // reject absurdly large source files outright
const TARGET_SIZE = 512;
const TARGET_MAX_BYTES = 300 * 1024;

type Status = 'idle' | 'uploading' | 'success' | 'error';

/**
 * Resizes/crops the source image to a TARGET_SIZE x TARGET_SIZE square
 * (center-cropped, cover-fit) and re-encodes as WebP, iterating the quality
 * down until the result fits under TARGET_MAX_BYTES (or hits a quality floor).
 */
async function processImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

  const canvas = document.createElement('canvas');
  canvas.width = TARGET_SIZE;
  canvas.height = TARGET_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unsupported');

  const scale = Math.max(TARGET_SIZE / bitmap.width, TARGET_SIZE / bitmap.height);
  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  const offsetX = (TARGET_SIZE - drawWidth) / 2;
  const offsetY = (TARGET_SIZE - drawHeight) / 2;
  ctx.drawImage(bitmap, offsetX, offsetY, drawWidth, drawHeight);

  let quality = 0.85;
  for (let attempt = 0; attempt < 5; attempt++) {
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
    if (!blob) throw new Error('encode_failed');
    if (blob.size <= TARGET_MAX_BYTES || quality <= 0.4) return blob;
    quality -= 0.15;
  }
  throw new Error('encode_failed');
}

export function AvatarEditor({ userId, name, initialUrl }: { userId: string; name: string; initialUrl: string | null }) {
  const [url, setUrl] = useState(initialUrl);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleFile(file: File) {
    setMessage(null);

    if (!file.type.startsWith('image/')) {
      setStatus('error');
      setMessage('Bitte eine Bilddatei auswählen.');
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setStatus('error');
      setMessage('Das Bild darf maximal 15 MB groß sein.');
      return;
    }

    setStatus('uploading');
    setMessage(t('profile.avatar.uploading'));

    try {
      const blob = await processImage(file);
      const objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl); // instant local preview while the upload happens

      const supabase = createClient();
      const path = `${userId}/avatar.webp`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { upsert: true, contentType: 'image/webp', cacheControl: '3600' });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const versionedUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

      const { error: updateError } = await supabase.from('profiles').update({ avatar_url: versionedUrl }).eq('id', userId);
      if (updateError) throw updateError;

      setUrl(versionedUrl);
      setStatus('success');
      setMessage(t('profile.avatar.updated'));
      router.refresh(); // picks up the new avatar anywhere else it's rendered server-side
    } catch {
      setStatus('error');
      setMessage(t('profile.avatar.failed'));
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <Avatar src={url} name={name} size="xl" />
        {status === 'uploading' && (
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          </div>
        )}
      </div>

      <label className="btn-ghost cursor-pointer bg-neutral-150">
        {status === 'uploading' ? t('common.loading') : t('onboarding.photo.upload')}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          disabled={status === 'uploading'}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
      </label>

      {message && (
        <p className={`text-xs ${status === 'error' ? 'text-red-400' : status === 'success' ? 'text-emerald-400' : 'text-neutral-400'}`}>
          {message}
        </p>
      )}
    </div>
  );
}
