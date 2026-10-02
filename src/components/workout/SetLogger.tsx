'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { addSetAction } from '@/app/(app)/aktivitaet/actions';
import { ExerciseHistorySheet } from '@/components/workout/ExerciseHistorySheet';
import { LastResultBlock } from '@/components/workout/LastResultBlock';
import { useExerciseActions } from '@/components/workout/ExerciseActions';
import { normalizeExerciseType, prefersPace } from '@/lib/exercise-types';
import type { LastResultState } from '@/lib/exercise-history';
import {
  fieldsAllowedFor,
  hasAnyValue,
  isSetBased,
  pickAllowed,
  retainedAfterSave,
  sameValues,
  suggestionFromSavedSet,
  valuesFromSet,
  type BodyweightMode,
  type FieldName,
  type FormValues,
  type SetSnapshot,
} from '@/lib/set-form';
import { newUuid } from '@/lib/uuid';
import { clearDraft, isWorkoutEnded, readDraft, writeDraft, type DraftScope } from '@/lib/workout-drafts';
import { formatPace, formatSpeed, paceSecondsPerKm, parseDuration, speedKmh } from '@/lib/workout-metrics';
import type { ExerciseType } from '@/types/database';

// useLayoutEffect warns when a client component is rendered on the server.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const GRID = 'grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-3';
const DRAFT_DEBOUNCE_MS = 400;

export interface SavedSet extends SetSnapshot {
  set_number: number;
}

function savedMessage(saved: { setNumber: number; replayed: boolean; changedAfterRetry: boolean }, setBased: boolean): string {
  if (saved.replayed && saved.changedAfterRetry) return 'Dieser Eintrag war schon mit den ursprünglichen Werten gespeichert – deine Änderung wurde nicht übernommen. Prüfe ihn in der Liste.';
  if (saved.replayed) return 'Dieser Eintrag war bereits gespeichert.';
  return setBased ? `Satz ${saved.setNumber} gespeichert.` : 'Eintrag gespeichert.';
}

/** Where the values currently in the inputs came from — decides the hint under the form
 * and whether copying earlier values needs a confirmation. */
type Source = 'baseline' | 'draft' | 'history' | 'typed';

function Field({
  id,
  label,
  name,
  unit,
  placeholder,
  mode = 'decimal',
  required,
  value,
  onChange,
}: {
  id: string;
  label: string;
  name: FieldName;
  unit?: string;
  placeholder?: string;
  mode?: 'decimal' | 'numeric' | 'text';
  required?: boolean;
  value: string;
  onChange: (name: FieldName, value: string) => void;
}) {
  return (
    <div className="min-w-0">
      <label className="label text-xs" htmlFor={id}>
        {label}
        {unit ? ` (${unit})` : ''}
      </label>
      <input
        id={id}
        name={name}
        inputMode={mode}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
        className="input-field w-full py-2.5 text-sm"
      />
    </div>
  );
}

/** Live pace / speed preview for distance cardio. */
function cardioPreview(name: string, values: FormValues): string {
  const d = parseDuration(values.duration ?? '');
  const km = Number((values.distanceKm ?? '').replace(',', '.')) || null;
  const pace = paceSecondsPerKm(d, km);
  const speed = speedKmh(d, km);
  if (!pace || !speed) return '';
  return prefersPace(name) ? `Pace ${formatPace(pace)} · Ø ${formatSpeed(speed)}` : `Ø ${formatSpeed(speed)} · Pace ${formatPace(pace)}`;
}

export function SetLogger({
  userId,
  workoutId,
  workoutExerciseId,
  exerciseId,
  exerciseType,
  exerciseName,
  savedSets,
  lastResult,
  historyEnabled,
}: {
  userId: string;
  workoutId: string;
  workoutExerciseId: string;
  exerciseId: string;
  exerciseType: ExerciseType;
  exerciseName: string;
  /** The sets of this exercise already stored, in order. */
  savedSets: SavedSet[];
  lastResult: LastResultState;
  /** False until the database has the history function. */
  historyEnabled: boolean;
}) {
  const type = normalizeExerciseType(exerciseType);
  const setBased = isSetBased(type);
  const router = useRouter();
  const uid = useId();
  const actions = useExerciseActions();
  const [pending, startTransition] = useTransition();

  // ---- what the form starts with: a suggestion from the last SAVED set (set-based types only) ----
  const [baseline, setBaseline] = useState(() => {
    const s = suggestionFromSavedSet(type, savedSets[savedSets.length - 1]);
    return { values: s.values, bwMode: s.bwMode ?? ('reps' as BodyweightMode) };
  });
  const [values, setValues] = useState<FormValues>(baseline.values);
  const [bwMode, setBwMode] = useState<BodyweightMode>(baseline.bwMode);
  const [source, setSource] = useState<Source>('baseline');
  const [more, setMore] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const [pendingCopy, setPendingCopy] = useState<{ index: number; values: FormValues; bwMode: BodyweightMode | undefined } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // ---- saving ----
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ setNumber: number; replayed: boolean; changedAfterRetry: boolean } | null>(null);
  // The set number the server confirmed, valid only while the list of saved sets is still the one it was confirmed
  // against: once the refreshed list arrives (or a set is deleted) the list itself is the truth again.
  const [confirmedAt, setConfirmedAt] = useState<{ atLength: number; count: number } | null>(null);
  const [collapsed, setCollapsed] = useState(!setBased && savedSets.length > 0);
  // One id per ENTRY: it stays the same across retries of that entry and changes only after a confirmed save.
  const [submissionId, setSubmissionId] = useState(() => newUuid());
  // The outcome of the last attempt is unknown (no answer arrived): the entry may or may not be stored.
  const [uncertain, setUncertain] = useState(false);
  // "Entwurf verwerfen" asks once more (it sits next to the save button and would cost typed input).
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  useEffect(() => {
    if (!confirmDiscard) return;
    const timer = window.setTimeout(() => setConfirmDiscard(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmDiscard]);
  // Entries whose save was already confirmed: a second answer for the same entry (a double tap sends it twice) is ignored.
  const confirmedEntries = useRef(new Set<string>());
  // What was sent the first time under the current entry id — to notice a retry that carries different values.
  const firstAttempt = useRef<{ id: string; values: FormValues } | null>(null);
  const nextSetNumber = (confirmedAt && confirmedAt.atLength === savedSets.length ? Math.max(confirmedAt.count, savedSets.length) : savedSets.length) + 1;

  // Where the save button sat before saving: a new set row appears above the form and would push the button
  // down, so the next tap would miss it (browsers without scroll anchoring, notably iOS Safari).
  const submitRef = useRef<HTMLButtonElement>(null);
  const anchorTop = useRef<number | null>(null);
  const anchorScrollY = useRef(0);
  useIsoLayoutEffect(() => {
    const button = submitRef.current;
    const before = anchorTop.current;
    anchorTop.current = null;
    if (before == null || !button) return;
    if (Math.abs(window.scrollY - anchorScrollY.current) > 2) return; // the user scrolled meanwhile: not ours to correct
    const delta = button.getBoundingClientRect().top - before;
    if (Math.abs(delta) > 1 && Math.abs(delta) < 300) window.scrollBy({ top: delta, behavior: 'auto' });
  }, [savedSets.length]);

  // ---- local draft ----
  const [draftState, setDraftState] = useState<'none' | 'saved' | 'restored' | 'unavailable'>('none');
  const scope: DraftScope = useMemo(() => ({ userId, workoutId, workoutExerciseId, type }), [userId, workoutId, workoutExerciseId, type]);
  const touchedRef = useRef(false); // the user has typed or chosen something since mount
  const mountedRef = useRef(false);
  // Right after a draft was restored the state equals what is stored: writing it again would only re-stamp it
  // (restarting its 24 h expiry) and replace "wiederhergestellt" by "gespeichert". Any edit clears this.
  const skipPersistRef = useRef(false);

  const dirty = !sameValues(values, baseline.values) || (type === 'bodyweight' && bwMode !== baseline.bwMode);

  // The latest state, readable from timers and page-lifecycle events without re-subscribing.
  const latest = useRef({ values, bwMode, more, dirty });
  latest.current = { values, bwMode, more, dirty };

  const { registerDraftProbe, isRowRemoved } = actions;
  const persistDraft = useCallback(
    (reason: 'typing' | 'leaving') => {
      if (isRowRemoved(workoutExerciseId) || isWorkoutEnded(workoutId)) return; // replaced / finished / skipped / discarded: its draft must not come back
      const cur = latest.current;
      if (!cur.dirty) {
        // Only the debounced path may delete a draft (the user went back to the suggestion); a lifecycle
        // flush must never wipe a stored draft that has not been restored yet.
        if (reason === 'typing') {
          clearDraft(scope);
          setDraftState((s) => (s === 'unavailable' ? s : 'none'));
        }
        return;
      }
      const ok = writeDraft(scope, exerciseId, { values: cur.values, bwMode: type === 'bodyweight' ? cur.bwMode : undefined, more: cur.more }, Date.now());
      if (reason === 'typing') setDraftState(ok ? 'saved' : 'unavailable');
    },
    [scope, exerciseId, type, workoutExerciseId, workoutId, isRowRemoved],
  );

  // Restore a draft once, after mount — and never over something the user already typed.
  useEffect(() => {
    const res = readDraft(scope, exerciseId, Date.now());
    if (res.status === 'unavailable') {
      setDraftState('unavailable');
      return;
    }
    if (res.status !== 'ok' || touchedRef.current) return;
    const mode: BodyweightMode = res.draft.bwMode ?? 'reps';
    const picked = pickAllowed(res.draft.values, fieldsAllowedFor(type, mode));
    if (!hasAnyValue(picked)) {
      clearDraft(scope);
      return;
    }
    setBwMode(mode);
    setValues(picked);
    setMore(res.draft.more === true);
    setSource('draft');
    setDraftState('restored');
    skipPersistRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced write while typing; flushed at once when the page is hidden or left.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      if (skipPersistRef.current) {
        skipPersistRef.current = false;
        return;
      }
      persistDraft('typing');
    }, DRAFT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [values, bwMode, more, baseline, persistDraft]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') persistDraft('leaving');
    };
    const onPageHide = () => persistDraft('leaving');
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      persistDraft('leaving'); // leaving the screen (navigation inside the app)
    };
  }, [persistDraft]);

  // The replace flow needs to know whether this exercise holds unsaved input.
  useEffect(() => registerDraftProbe(workoutExerciseId, () => latest.current.dirty), [registerDraftProbe, workoutExerciseId]);

  // ---- editing ----
  function touch() {
    touchedRef.current = true;
    skipPersistRef.current = false;
    setSource('typed');
    setSaved(null);
    setCopyNote(null);
    setCopiedIndex(null);
    setPendingCopy(null);
    setError(null);
  }

  function onField(name: FieldName, value: string) {
    touch();
    setValues((v) => ({ ...v, [name]: value }));
  }

  function chooseMode(mode: BodyweightMode) {
    touch();
    setBwMode(mode);
  }

  function discardDraft() {
    setConfirmDiscard(false);
    touchedRef.current = true;
    setValues(baseline.values);
    setBwMode(baseline.bwMode);
    setSource('baseline');
    setCopiedIndex(null);
    setCopyNote(null);
    clearDraft(scope);
    setDraftState((s) => (s === 'unavailable' ? s : 'none'));
  }

  // ---- copying an earlier result into the inputs (never saves) ----
  function applyCopy(index: number, copied: FormValues, mode: BodyweightMode | undefined) {
    touchedRef.current = true;
    skipPersistRef.current = false;
    const nextMode = mode ?? bwMode;
    setBwMode(nextMode);
    setValues(copied);
    setSource('history');
    setCopiedIndex(index);
    const noun = setBased ? 'Satz' : 'Eintrag';
    const many = lastResult.status === 'ok' && lastResult.entry.sets.length > 1;
    setCopyNote(`${many ? `Werte aus ${noun} ${index + 1}` : 'Werte vom letzten Mal'} übernommen – noch nicht gespeichert.`);
    setSaved(null);
    setPendingCopy(null);
    setError(null);
  }

  function requestCopy(index: number) {
    if (lastResult.status !== 'ok') return;
    const set = lastResult.entry.sets[index];
    if (!set) return;
    const { values: raw, bwMode: mode } = valuesFromSet(type, set);
    const copied = pickAllowed(raw, fieldsAllowedFor(type, mode ?? bwMode));
    if (!hasAnyValue(copied)) return;
    // Typed or restored input is the user's own work: ask before replacing it.
    const ownWork = (source === 'typed' || source === 'draft') && !sameValues(values, baseline.values);
    if (ownWork) {
      setPendingCopy({ index, values: copied, bwMode: mode });
      return;
    }
    applyCopy(index, copied, mode);
  }

  // ---- saving ----
  function buildFormData(): FormData {
    const fd = new FormData();
    fd.set('workoutExerciseId', workoutExerciseId);
    fd.set('submissionId', submissionId);
    const allowed = fieldsAllowedFor(type, bwMode);
    for (const [name, raw] of Object.entries(values)) {
      if (allowed.has(name as FieldName) && raw != null && raw.trim() !== '') fd.set(name, raw);
    }
    return fd;
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    const submitted = values;
    const mode = bwMode;
    const formData = buildFormData();
    const entryId = submissionId;
    if (firstAttempt.current?.id !== entryId) firstAttempt.current = { id: entryId, values: submitted };
    anchorTop.current = setBased ? (submitRef.current?.getBoundingClientRect().top ?? null) : null;
    anchorScrollY.current = window.scrollY;
    startTransition(async () => {
      try {
        const res = await addSetAction(formData);
        if (!res.ok) {
          anchorTop.current = null;
          setError(res.error);
          return;
        }
        if (confirmedEntries.current.has(entryId)) return; // this entry was already confirmed by an earlier answer
        confirmedEntries.current.add(entryId);
        // Server-confirmed: only now does the set number advance and the form get its next suggestion.
        const retained = retainedAfterSave(type, mode, submitted);
        // The inputs stay editable while a save is running: if the user already typed the NEXT entry, that is
        // theirs and must not be replaced by the suggestion derived from the entry that was just saved.
        const typedSince = !sameValues(latest.current.values, submitted) || (type === 'bodyweight' && latest.current.bwMode !== mode);
        // A retry after a lost answer that carries other values than the first try: the server kept the first.
        const first = firstAttempt.current;
        const changedAfterRetry = res.replayed && !!first && first.id === entryId && !sameValues(first.values, submitted);
        firstAttempt.current = null;
        setConfirmedAt({ atLength: savedSets.length, count: res.setNumber });
        setSaved({ setNumber: res.setNumber, replayed: res.replayed, changedAfterRetry });
        setSubmissionId(newUuid());
        setUncertain(false);
        setBaseline({ values: retained, bwMode: mode });
        if (!typedSince) {
          setValues(retained);
          setSource('baseline');
          touchedRef.current = true;
          clearDraft(scope);
          setDraftState((s) => (s === 'unavailable' ? s : 'none'));
        }
        setCopiedIndex(null);
        setCopyNote(null);
        setPendingCopy(null);
        if (!setBased) setCollapsed(true);
      } catch {
        // The outcome is unknown (the request may or may not have arrived): keep the input and the
        // entry's id, so trying again can never store the entry twice.
        anchorTop.current = null;
        setUncertain(true);
        setError('Keine Verbindung – der Eintrag wurde möglicherweise nicht gespeichert. Du kannst es erneut versuchen, doppeltes Speichern wird verhindert.');
      }
    });
  }

  const cta = setBased ? `Satz ${nextSetNumber} speichern` : 'Speichern';
  const fieldId = (name: FieldName) => `${uid}-${name}`;
  const fieldProps = (name: FieldName) => ({ id: fieldId(name), name, value: values[name] ?? '', onChange: onField });

  const hint =
    copyNote ??
    (draftState === 'restored' && source === 'draft' ? 'Entwurf wiederhergestellt – noch nicht gespeichert.' : null) ??
    (setBased && source === 'baseline' && hasAnyValue(values) ? 'Werte vom letzten Satz vorbereitet – noch nicht gespeichert.' : null);

  if (collapsed) {
    return (
      <div className="flex flex-col gap-2">
        {saved && (
          <p className="flex items-center gap-1.5 text-sm font-semibold text-brand" role="status">
            <Check size={15} strokeWidth={2.5} /> {savedMessage(saved, false)}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setCollapsed(false);
            setSaved(null);
          }}
          className="btn-secondary min-h-[44px] self-start px-4 text-sm"
        >
          <Plus size={16} strokeWidth={2.25} /> Weiteren Eintrag hinzufügen
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" aria-label={`${exerciseName} erfassen`}>
      <LastResultBlock
        type={type}
        exerciseName={exerciseName}
        state={lastResult}
        nextSetNumber={nextSetNumber}
        copiedIndex={copiedIndex}
        onCopy={requestCopy}
        onHistory={historyEnabled ? () => setHistoryOpen(true) : undefined}
        onRetry={() => router.refresh()}
      />

      {pendingCopy && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/[0.06] p-3" role="alertdialog" aria-label="Eingaben ersetzen?">
          <p className="text-sm font-semibold text-neutral-900">Deine Eingaben ersetzen?</p>
          <p className="mt-0.5 text-xs text-neutral-500">Deine nicht gespeicherten Eingaben werden durch die Werte vom letzten Mal ersetzt.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => applyCopy(pendingCopy.index, pendingCopy.values, pendingCopy.bwMode)} className="btn-primary min-h-[44px] flex-1 px-3 text-sm">
              Ersetzen
            </button>
            <button type="button" autoFocus onClick={() => setPendingCopy(null)} className="btn-secondary min-h-[44px] flex-1 px-3 text-sm">
              Behalten
            </button>
          </div>
        </div>
      )}

      {type === 'strength' && (
        <div className={GRID}>
          <Field {...fieldProps('weight')} label="Gewicht" unit="kg" placeholder="80" required />
          <Field {...fieldProps('reps')} label="Wdh." placeholder="10" mode="numeric" required />
        </div>
      )}

      {type === 'bodyweight' && (
        <>
          <div className="segmented !rounded-xl text-xs" role="group" aria-label="Eingabeart">
            {(['reps', 'duration'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={bwMode === m}
                onClick={() => chooseMode(m)}
                className={`segmented-item !min-h-[44px] !rounded-lg !py-2 !text-xs ${bwMode === m ? 'segmented-item-active' : ''}`}
              >
                {m === 'reps' ? 'Wiederholungen' : 'Dauer'}
              </button>
            ))}
          </div>
          <div className={GRID}>
            {bwMode === 'reps' ? (
              <Field {...fieldProps('reps')} label="Wdh." placeholder="10" mode="numeric" required />
            ) : (
              <Field {...fieldProps('duration')} label="Dauer" unit="mm:ss" placeholder="01:00" mode="text" required />
            )}
            <Field {...fieldProps('weight')} label="Zusatzgewicht" unit="kg" placeholder="optional" />
          </div>
        </>
      )}

      {type === 'cardio_distance' && (
        <>
          <div className={GRID}>
            <Field {...fieldProps('duration')} label="Zeit" unit="mm:ss" placeholder="42:30" mode="text" required />
            <Field {...fieldProps('distanceKm')} label="Distanz" unit="km" placeholder="8,2" />
          </div>
          {cardioPreview(exerciseName, values) && <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm font-semibold text-brand">{cardioPreview(exerciseName, values)}</p>}
        </>
      )}

      {type === 'interval' && (
        <div className={GRID}>
          <Field {...fieldProps('rounds')} label="Runden" placeholder="8" mode="numeric" required />
          <Field {...fieldProps('workSeconds')} label="Belastung" unit="Sek." placeholder="40" mode="numeric" required />
          <Field {...fieldProps('intervalRestSeconds')} label="Pause" unit="Sek." placeholder="20" mode="numeric" />
        </div>
      )}

      {(type === 'cardio_time' || type === 'mobility' || type === 'sport' || type === 'other') && (
        <div className={GRID}>
          <Field {...fieldProps('duration')} label="Dauer" unit="mm:ss" placeholder="30:00" mode="text" required />
        </div>
      )}

      <button
        type="button"
        onClick={() => setMore((v) => !v)}
        className="flex min-h-[44px] items-center gap-1 self-start text-xs font-semibold text-neutral-400"
        aria-expanded={more}
        aria-controls={`${uid}-more`}
      >
        <ChevronDown size={14} className={`transition ${more ? 'rotate-180' : ''}`} />
        Weitere Daten
      </button>

      <div id={`${uid}-more`} className={more ? 'flex flex-col gap-3' : 'hidden'}>
        <div className={GRID}>
          {type === 'strength' && (
            <>
              <Field {...fieldProps('rpe')} label="RPE" placeholder="1–10" />
              <Field {...fieldProps('restSeconds')} label="Pause" unit="Sek." mode="numeric" />
            </>
          )}
          {type === 'bodyweight' && <Field {...fieldProps('rpe')} label="RPE" placeholder="1–10" />}
          {type === 'cardio_distance' && (
            <>
              <Field {...fieldProps('elevationGainM')} label="Höhenmeter" unit="m" mode="numeric" />
              <Field {...fieldProps('inclinePct')} label="Steigung" unit="%" />
            </>
          )}
          {type !== 'strength' && (
            <>
              <Field {...fieldProps('calories')} label="Kalorien" unit="kcal" mode="numeric" />
              <Field {...fieldProps('avgHeartRate')} label="Ø Puls" unit="bpm" mode="numeric" />
              <Field {...fieldProps('maxHeartRate')} label="Max. Puls" unit="bpm" mode="numeric" />
            </>
          )}
        </div>
        <div className="min-w-0">
          <label className="label text-xs" htmlFor={fieldId('notes')}>
            Notiz
          </label>
          <input
            id={fieldId('notes')}
            name="notes"
            maxLength={500}
            autoComplete="off"
            value={values.notes ?? ''}
            onChange={(e) => onField('notes', e.target.value)}
            className="input-field w-full py-2.5 text-sm"
          />
        </div>
      </div>

      {error && (
        <p className="text-sm font-medium text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button ref={submitRef} type="submit" aria-disabled={pending} className={`btn-primary px-4 py-2.5 text-sm ${pending ? 'opacity-70' : ''}`}>
          <Plus size={16} strokeWidth={2.25} />
          {pending ? 'Speichern…' : uncertain ? 'Erneut versuchen' : cta}
        </button>
        {(draftState === 'saved' || draftState === 'restored') && dirty && (
          <button
            type="button"
            onClick={() => (confirmDiscard ? discardDraft() : setConfirmDiscard(true))}
            className={`min-h-[44px] px-1 text-xs font-semibold ${confirmDiscard ? 'text-red-400' : 'text-neutral-500'}`}
          >
            {confirmDiscard ? 'Wirklich verwerfen?' : 'Entwurf verwerfen'}
          </button>
        )}
      </div>

      <div aria-live="polite" className="flex flex-col gap-1">
        {saved && (
          <p className="flex items-center gap-1.5 text-sm font-semibold text-brand">
            <Check size={15} strokeWidth={2.5} />
            {savedMessage(saved, setBased)}
          </p>
        )}
        {hint && !saved && <p className="text-xs font-medium text-neutral-500">{hint}</p>}
        {draftState === 'saved' && <p className="text-xs text-neutral-500">Entwurf auf diesem Gerät gespeichert</p>}
        {draftState === 'unavailable' && <p className="text-xs text-neutral-500">Lokale Wiederherstellung ist auf diesem Gerät nicht verfügbar. Deine Eingaben bleiben, solange du diese Seite offen lässt.</p>}
      </div>


      {historyOpen && (
        <ExerciseHistorySheet exerciseId={exerciseId} exerciseName={exerciseName} exerciseType={type} workoutId={workoutId} onClose={() => setHistoryOpen(false)} />
      )}
    </form>
  );
}
