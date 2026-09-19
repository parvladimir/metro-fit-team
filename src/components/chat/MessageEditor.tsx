'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { clipboardToMarkdown } from '@/lib/chat-format';

/** Inline editor showing the stored Markdown source. Saves the SAME message. */
export function MessageEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (text: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 288)}px`;
  }, [text]);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const err = await onSave(text);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <div className="flex w-full flex-col gap-2" onClick={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={2000}
        rows={3}
        aria-label="Nachricht bearbeiten"
        onPaste={(e) => {
          const html = e.clipboardData.getData('text/html');
          const plain = e.clipboardData.getData('text/plain');
          if (!html && !plain) return;
          e.preventDefault();
          const md = clipboardToMarkdown({ html, text: plain }, (h) => new DOMParser().parseFromString(h, 'text/html').body);
          const el = e.currentTarget;
          el.setRangeText(md, el.selectionStart, el.selectionEnd, 'end');
          setText(el.value);
        }}
        className="input-field max-h-72 w-full resize-none overflow-y-auto font-mono text-[13px] leading-relaxed"
      />
      {error && <p className="text-xs font-medium text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="btn-ghost bg-neutral-150 px-4 text-xs">
          Abbrechen
        </button>
        <button type="button" onClick={save} disabled={busy} className="btn-primary px-4 py-2 text-xs">
          {busy ? <Loader2 size={14} className="animate-spin" /> : 'Speichern'}
        </button>
      </div>
    </div>
  );
}
