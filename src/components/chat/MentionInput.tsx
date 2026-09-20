'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { filterMembers, findMentionQuery, insertMention, type MentionMember } from '@/lib/mentions';

export type MentionInputHandle = { focus: () => void; el: HTMLTextAreaElement | null };

interface Props extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value: string;
  onValueChange: (v: string) => void;
  members: MentionMember[];
  /** members picked through the list; the parent filters by what is still in the text */
  onPick: (m: MentionMember) => void;
}

/** Textarea with an @-autocomplete list directly ABOVE it (thumb-friendly on
 * phones). Desktop: ↑ ↓ Enter/Tab Escape. The list only opens for a real "@"
 * (start of text or after whitespace) — never for e-mail addresses. */
export const MentionInput = forwardRef<MentionInputHandle, Props>(function MentionInput(
  { value, onValueChange, members, onPick, onKeyDown, onInput, ...rest },
  ref
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [active, setActive] = useState(0);

  useImperativeHandle(ref, () => ({ focus: () => taRef.current?.focus(), get el() { return taRef.current; } }));

  const q = useMemo(() => (members.length ? findMentionQuery(value, caret) : null), [value, caret, members.length]);
  const matches = useMemo(() => (q ? filterMembers(members, q.query) : []), [q, members]);
  const open = !!q && matches.length > 0 && dismissed !== q.start;

  useEffect(() => setActive(0), [q?.query, q?.start]);

  function syncCaret(el: HTMLTextAreaElement) {
    setCaret(el.selectionStart ?? el.value.length);
  }

  function pick(m: MentionMember) {
    if (!q) return;
    const el = taRef.current;
    const at = el?.selectionStart ?? caret;
    const next = insertMention(value, q, at, m.name);
    onValueChange(next.text);
    onPick(m);
    setDismissed(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.caret, next.caret);
      setCaret(next.caret);
    });
  }

  return (
    <div className="relative min-w-0 flex-1">
      {open && (
        <ul
          role="listbox"
          aria-label="Teammitglieder erwähnen"
          className="absolute bottom-full left-0 right-0 z-30 mb-2 max-h-56 overflow-y-auto rounded-2xl border border-white/10 bg-neutral-150 p-1 shadow-xl"
        >
          {matches.map((m, i) => (
            <li key={m.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                // mousedown/touchstart keep the textarea focused so the keyboard stays open
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(m)}
                className={`flex w-full min-h-[44px] items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left transition ${i === active ? 'bg-brand/15' : 'active:bg-neutral-200'}`}
              >
                <Avatar src={m.avatarUrl} name={m.name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-900">{m.name}</span>
                {m.role === 'team_admin' && (
                  <span className="shrink-0 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-semibold text-brand">Admin</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        {...rest}
        ref={taRef}
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value);
          syncCaret(e.currentTarget);
          setDismissed(null);
        }}
        onInput={onInput}
        onSelect={(e) => syncCaret(e.currentTarget)}
        onClick={(e) => syncCaret(e.currentTarget)}
        onKeyUp={(e) => syncCaret(e.currentTarget)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              return setActive((a) => (a + 1) % matches.length);
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              return setActive((a) => (a - 1 + matches.length) % matches.length);
            }
            if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
              e.preventDefault();
              return pick(matches[active]!);
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              return setDismissed(q!.start);
            }
          }
          onKeyDown?.(e);
        }}
        aria-autocomplete="list"
      />
    </div>
  );
});
