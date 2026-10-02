'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, PlusCircle, Search, Star } from 'lucide-react';
import { MUSCLE_GROUP_OPTIONS, exerciseTypeLabel } from '@/lib/exercise-types';
import type { Exercise } from '@/types/database';

export type PickerExercise = Pick<Exercise, 'id' | 'name' | 'exercise_type' | 'muscle_group' | 'is_custom'>;

/** Case- and umlaut-insensitive: "bankdr" finds "Bankdrücken". */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function filterExercises(items: PickerExercise[], query: string): PickerExercise[] {
  const q = normalizeSearch(query);
  if (!q) return items;
  return items.filter((e) => normalizeSearch(e.name).includes(q));
}

export type PickerTab = 'favorites' | 'recent' | 'all';

/** Which tab opens first: the user's favourites if there are any, else what they used lately, else everything. */
export function defaultPickerTab(favoriteCount: number | null, recentCount: number | null): PickerTab {
  if (favoriteCount && favoriteCount > 0) return 'favorites';
  if (recentCount && recentCount > 0) return 'recent';
  return 'all';
}

/** The exercises one tab shows. Favourites are listed by name, recent ones in the order given (most recent
 * first); both only contain exercises the picker was given (so one that is gone or not visible never appears). */
export function itemsForTab(items: PickerExercise[], tab: PickerTab, favoriteIds: ReadonlySet<string>, recentIds: readonly string[]): PickerExercise[] {
  if (tab === 'favorites') return items.filter((e) => favoriteIds.has(e.id)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  if (tab === 'recent') {
    const byId = new Map(items.map((e) => [e.id, e]));
    return recentIds.map((id) => byId.get(id)).filter((e): e is PickerExercise => !!e);
  }
  return items;
}

export interface PickerFavorites {
  ids: ReadonlySet<string>;
  /** Called with the NEW state (true = now a favourite). */
  onToggle: (exerciseId: string, favorite: boolean) => void;
}

function Row({
  exercise,
  disabled,
  favorite,
  onPick,
  onToggleFavorite,
}: {
  exercise: PickerExercise;
  disabled: boolean;
  favorite: boolean | null;
  onPick: (e: PickerExercise) => void;
  onToggleFavorite: ((exerciseId: string, favorite: boolean) => void) | null;
}) {
  return (
    <li className="flex items-center">
      <button
        type="button"
        onClick={() => onPick(exercise)}
        disabled={disabled}
        className="flex min-h-[48px] min-w-0 flex-1 items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition active:bg-neutral-150 disabled:opacity-40"
      >
        <span className="min-w-0">
          <span className="block break-words text-sm font-semibold text-neutral-900">{exercise.name}</span>
          <span className="block text-xs text-neutral-500">{exerciseTypeLabel(exercise.exercise_type)}</span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-neutral-400" />
      </button>
      {onToggleFavorite && favorite !== null && (
        <button
          type="button"
          onClick={() => onToggleFavorite(exercise.id, !favorite)}
          aria-pressed={favorite}
          aria-label={`${favorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}: ${exercise.name}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-neutral-400 transition active:bg-neutral-150"
        >
          <Star size={19} strokeWidth={1.9} className={favorite ? 'text-amber-300' : ''} fill={favorite ? 'currentColor' : 'none'} />
        </button>
      )}
    </li>
  );
}

const TAB_LABEL: Record<PickerTab, string> = { favorites: 'Favoriten', recent: 'Zuletzt', all: 'Alle' };

/** Search + the exercises the user may use. Tabs Favoriten · Zuletzt · Alle appear only for the parts that are
 * available (a missing database function or table hides its tab and the stars instead of failing when tapped).
 * "Alle" is "Meine Übungen" first, then by muscle group. The caller decides what picking does. */
export function ExercisePicker({
  items,
  disabledId,
  onPick,
  createHref,
  favorites,
  recentIds,
}: {
  items: PickerExercise[];
  /** An exercise that cannot be chosen (e.g. the one being replaced). */
  disabledId?: string;
  onPick: (exercise: PickerExercise) => void;
  /** Link to the existing "Eigene Übung erstellen" flow. */
  createHref?: string;
  /** Absent = favourites are not available (no tab, no stars). */
  favorites?: PickerFavorites | null;
  /** Absent = recently used exercises are not available (no tab). */
  recentIds?: readonly string[] | null;
}) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const tabsId = useId();

  const availableTabs = useMemo<PickerTab[]>(() => [...(favorites ? (['favorites'] as const) : []), ...(recentIds ? (['recent'] as const) : []), 'all'], [favorites, recentIds]);
  const [tab, setTab] = useState<PickerTab>(() => defaultPickerTab(favorites ? favorites.ids.size : null, recentIds ? recentIds.length : null));
  // Searching always looks through every exercise: a favourite you cannot find in "Favoriten" must not be a dead end.
  const searching = query.trim() !== '';
  const activeTab: PickerTab = searching ? 'all' : availableTabs.includes(tab) ? tab : 'all';

  const favoriteIds = favorites?.ids ?? EMPTY_SET;
  const shown = useMemo(() => filterExercises(itemsForTab(items, activeTab, favoriteIds, recentIds ?? []), query), [items, activeTab, favoriteIds, recentIds, query]);

  const groups = useMemo(() => {
    if (activeTab !== 'all') return [{ label: '', items: shown }];
    const mine = shown.filter((e) => e.is_custom);
    const out: { label: string; items: PickerExercise[] }[] = [];
    if (mine.length) out.push({ label: 'Meine Übungen', items: mine });
    for (const g of MUSCLE_GROUP_OPTIONS) {
      const list = shown.filter((e) => !e.is_custom && e.muscle_group === g.value);
      if (list.length) out.push({ label: g.label, items: list });
    }
    return out;
  }, [shown, activeTab]);

  const emptyText =
    activeTab === 'favorites'
      ? 'Noch keine Favoriten. Markiere Übungen mit dem Stern.'
      : activeTab === 'recent'
        ? 'Noch keine zuletzt benutzten Übungen. Sie erscheinen, sobald du Sätze erfasst hast.'
        : 'Keine Übung gefunden.';

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label htmlFor={searchId} className="sr-only">
          Übung suchen
        </label>
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            id={searchId}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Übung suchen…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input-field w-full !pl-10"
          />
        </div>
      </div>

      {availableTabs.length > 1 && (
        <div role="tablist" aria-label="Übungen" className="segmented !rounded-xl text-xs">
          {availableTabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`${tabsId}-${t}`}
              aria-selected={activeTab === t}
              onClick={() => {
                setTab(t);
                setQuery('');
              }}
              className={`segmented-item !min-h-[44px] !rounded-lg !py-2 !text-xs ${activeTab === t ? 'segmented-item-active' : ''}`}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="py-3 text-center text-sm text-neutral-500" role="status">
          {searching ? 'Keine Übung gefunden.' : emptyText}
        </p>
      ) : (
        <div className="flex flex-col gap-3" role="tabpanel" aria-labelledby={`${tabsId}-${activeTab}`}>
          {groups.map((g) => (
            <section key={g.label || activeTab} aria-label={g.label || TAB_LABEL[activeTab]}>
              {g.label && (!searching || groups.length > 1) ? <p className="section-title px-3 pb-1">{g.label}</p> : null}
              <ul className="flex flex-col">
                {g.items.map((e) => (
                  <Row
                    key={e.id}
                    exercise={e}
                    disabled={e.id === disabledId}
                    favorite={favorites ? favoriteIds.has(e.id) : null}
                    onPick={onPick}
                    onToggleFavorite={favorites ? favorites.onToggle : null}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {createHref && (
        <Link href={createHref} className="btn-ghost min-h-[44px] self-start px-4 text-sm text-brand">
          <PlusCircle size={16} strokeWidth={2} />
          Eigene Übung erstellen
        </Link>
      )}
    </div>
  );
}

const EMPTY_SET: ReadonlySet<string> = new Set();
