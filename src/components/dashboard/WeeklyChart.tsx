'use client';

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';

export function WeeklyChart({ data }: { data: { label: string; minutes: number }[] }) {
  return (
    <div className="h-32 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9ca3af' }} />
          <Tooltip
            cursor={{ fill: 'rgba(255,90,31,0.08)' }}
            contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: 12 }}
            formatter={(value: number) => [`${value} Min.`, 'Training']}
            labelFormatter={() => ''}
          />
          <Bar dataKey="minutes" radius={[6, 6, 6, 6]} fill="#FF5A1F" maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
