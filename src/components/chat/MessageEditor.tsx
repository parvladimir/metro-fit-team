'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { clipboardToMarkdown } from '@/lib/chat-format';
import { MentionInput, type MentionInputHandle } from '@/components/chat/MentionInput';
import { stillMentioned, type MentionMember, type MessageMention } from '@/lib/mentions';

/** Inline editor showing the stored Markdown source (including "@Name" text).
 * Existing mentions are preserved; new ones can be added through the same
 * autocomplete, and removing the text removes the mention on save. */
export function MessageEditor({
  initial,
  members,
  initialMentions,
  onSave,
  onCancel,
}: {
  initial: string;
  members: MentionMember[];
  initialMentions: MessageMention[];
  onSave: (text: string, mentionUserIds: string[]) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<MentionInputHandle>(null);
  // members the message already mentions + anything picked while editing
  const [picked, setPicked] = useState<MentionMember[]>(() => {
    const ids = new Set(initialMentions.map((m) => m.userId));
    return members.filter((m) => ids.has(m.id));
  });
  // mentions of people who are no longer selectable (left the team) stay untouched
  const keptIds = initialMentions.filter((m) => !members.some((x) => x.id === m.userId)).map((m) => m.userId);

  useEffect(() => {
    const el = ref.current?.el;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useEffect(() => {
    const el = ref.current?.el;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 288)}px`;
  }, [text]);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ids = [...stillMentioned(text, picked).map((m) => m.id), ...keptIds];
    const err = await onSave(text, ids);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <div className="flex w-full flex-col gap-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex">
        <MentionInput
          ref={ref}
          value={text}
          onValueChange={setText}
          members={members}
          onPick={(m) => setPicked((p) => (p.some((x) => x.id === m.id) ? p : [...p, m]))}
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
      </div>
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
