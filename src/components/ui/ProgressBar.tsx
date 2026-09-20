const TONES = {
  challenge: 'linear-gradient(90deg, #8b7cff 0%, #b3a8ff 100%)',
  primary: 'linear-gradient(90deg, #4ea8ff 0%, #00d7f5 100%)',
  success: 'linear-gradient(90deg, #35d07f 0%, #6be9a8 100%)',
} as const;

/** Slim progress bar with the app's accent gradients. Width animates (150–300ms). */
export function ProgressBar({ percent, tone = 'primary' }: { percent: number; tone?: keyof typeof TONES }) {
  const pct = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-neutral-50/70 ring-1 ring-white/5"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <div className="h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${pct}%`, background: TONES[tone] }} />
    </div>
  );
}
