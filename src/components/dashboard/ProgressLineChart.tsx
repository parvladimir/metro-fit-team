'use client';

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export function ProgressLineChart<T extends { weekLabel: string }>({
  data,
  dataKey,
  unit,
}: {
  data: T[];
  dataKey: keyof T & string;
  unit: string;
}) {
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <XAxis dataKey="weekLabel" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9ca3af' }} interval="preserveStartEnd" />
          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9ca3af' }} width={32} />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: 12 }}
            formatter={(value: number) => [`${value} ${unit}`, '']}
          />
          <Line type="monotone" dataKey={dataKey} stroke="#FF5A1F" strokeWidth={2.5} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
