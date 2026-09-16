/** ISO weekday: 1 = Montag ... 7 = Sonntag (matches workout_plan_days.weekday). */
export function isoWeekday(date: Date = new Date()): number {
  const day = date.getDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
}

export function startOfWeek(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diff = isoWeekday(d) - 1;
  d.setDate(d.getDate() - diff);
  return d;
}

export function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatGermanDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatGermanDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}
