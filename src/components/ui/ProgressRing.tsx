'use client';

import { useEffect, useRef, useState } from 'react';

const INITIAL_DURATION_MS = 1100;
const UPDATE_DURATION_MS = 400;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * A circular progress indicator that owns its own animated value — the
 * arc and the centered percentage both animate off the same number, so
 * they can never drift out of sync. Animates 0 -> percent on first mount
 * only (a later prop change animates from wherever it currently sits, over
 * a shorter duration, rather than replaying the "grand opening" sweep).
 * Respects prefers-reduced-motion by jumping straight to the final value.
 */
export function ProgressRing({
  percent,
  size = 160,
  strokeWidth = 9,
  label,
  gradientId = 'progressRingGradient',
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  gradientId?: string;
}) {
  const target = Math.max(0, Math.min(100, percent));
  const [displayPercent, setDisplayPercent] = useState(0);
  const isFirstRun = useRef(true);
  const lastValue = useRef(0);

  useEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion) {
      setDisplayPercent(target);
      lastValue.current = target;
      isFirstRun.current = false;
      return;
    }

    const fromValue = isFirstRun.current ? 0 : lastValue.current;
    const duration = isFirstRun.current ? INITIAL_DURATION_MS : UPDATE_DURATION_MS;
    const start = performance.now();
    let frame: number;

    function tick(now: number) {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      const eased = easeOutCubic(t);
      const value = fromValue + (target - fromValue) * eased;
      setDisplayPercent(Math.round(value));

      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        lastValue.current = target;
        isFirstRun.current = false;
      }
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (displayPercent / 100) * circumference;

  return (
    <div className="relative flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#5CF0FF" />
            <stop offset="100%" stopColor="#00D7F5" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="#1E383C" strokeWidth={strokeWidth} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ filter: 'drop-shadow(0 0 6px rgba(0, 215, 245, 0.45))' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center px-4 text-center">
        <span className="text-[26px] font-extrabold leading-none tracking-tight text-neutral-900">{displayPercent}%</span>
        {label && <span className="mt-1.5 text-xs font-medium text-neutral-400">{label}</span>}
      </div>
    </div>
  );
}
