'use client';

import { useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { t } from '@/lib/i18n';

export function AvatarUploader({ userId }: { userId: string }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Bitte eine Bilddatei auswählen.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Das Bild darf maximal 5 MB groß sein.');
      return;
    }

    setUploading(true);
    const supabase = createClient();
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${userId}/avatar.${ext}`;

    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });

    if (uploadError) {
      setError('Upload fehlgeschlagen.');
      setUploading(false);
      return;
    }

    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    const url = `${data.publicUrl}?t=${Date.now()}`;
    setPreview(url);
    if (hiddenInputRef.current) hiddenInputRef.current.value = url;
    setUploading(false);
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <input type="hidden" name="avatarUrl" ref={hiddenInputRef} />
      <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-neutral-100 text-3xl text-neutral-400">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : (
          '🙂'
        )}
      </div>
      <label className="btn-ghost cursor-pointer bg-neutral-100">
        {uploading ? t('common.loading') : t('onboarding.photo.upload')}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </label>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
