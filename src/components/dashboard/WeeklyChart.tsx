'use client';

import { useEffect, useState } from 'react';

// Deliberately not using Recharts here: this is a 7-bar sparkline on the
// most-visited page in the app, and pulling in a full charting library's
// runtime just for that added real weight to the dashboard's JS bundle.
// A plain animated SVG does the same job for a fraction of the bytes.
const WEEKDAY_LABELS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export function WeeklyChart({ data }: { data: { label: string; minutes: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.minutes));
  // "today" is only known on the client (server/client clocks and time zones differ)
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(WEEKDAY_LABELS[new Date().getDay()]!), []);

  return (
    <div className="flex h-28 items-end gap-2">
      {data.map((d) => {
        const active = d.minutes > 0;
        const isToday = today !== null && d.label.startsWith(today);
        const heightPct = active ? Math.max(8, (d.minutes / max) * 100) : 0;
        return (
          <div key={d.label} className="flex flex-1 flex-col items-center gap-1.5">
            <div className="flex h-20 w-full items-end justify-center">
              {active ? (
                <div
                  className="w-2.5 rounded-full transition-[height] duration-500 ease-out"
                  style={{
                    height: `${heightPct}%`,
                    background: 'linear-gradient(180deg, #4ea8ff 0%, #00d7f5 100%)',
                    boxShadow: '0 0 8px rgba(0, 215, 245, 0.35)',
                  }}
                  title={`${d.minutes} Min.`}
                />
              ) : (
                // no activity: a quiet marker, still visible on the dark card
                <div
                  className={`h-1.5 w-2.5 rounded-full ${isToday ? 'bg-brand/45' : 'bg-neutral-300/60'}`}
                  title="0 Min."
                />
              )}
            </div>
            <span className={`flex flex-col items-center gap-1 text-[11px] font-medium ${isToday ? 'text-neutral-900' : 'text-neutral-500'}`}>
              {d.label}
              <span className={`h-1 w-1 rounded-full ${isToday ? 'bg-brand' : 'bg-transparent'}`} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
