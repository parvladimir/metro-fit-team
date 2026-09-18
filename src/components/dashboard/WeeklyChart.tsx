'use client';

// Deliberately not using Recharts here: this is a 7-bar sparkline on the
// most-visited page in the app, and pulling in a full charting library's
// runtime just for that added real weight to the dashboard's JS bundle.
// A plain animated SVG does the same job for a fraction of the bytes.
export function WeeklyChart({ data }: { data: { label: string; minutes: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.minutes));

  return (
    <div className="flex h-28 items-end gap-2">
      {data.map((d) => {
        const heightPct = d.minutes > 0 ? Math.max(6, (d.minutes / max) * 100) : 3;
        return (
          <div key={d.label} className="flex flex-1 flex-col items-center gap-1.5">
            <div className="flex h-20 w-full items-end justify-center">
              <div
                className="w-2.5 rounded-full bg-brand transition-[height] duration-500 ease-out"
                style={{
                  height: `${heightPct}%`,
                  boxShadow: d.minutes > 0 ? '0 0 6px rgba(0, 215, 245, 0.4)' : undefined,
                  opacity: d.minutes > 0 ? 1 : 0.25,
                }}
                title={`${d.minutes} Min.`}
              />
            </div>
            <span className="text-[11px] font-medium text-neutral-500">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}
