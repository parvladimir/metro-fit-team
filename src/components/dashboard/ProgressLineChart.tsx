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
          <XAxis dataKey="weekLabel" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#5B7B7F' }} interval="preserveStartEnd" />
          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#5B7B7F' }} width={32} />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: '1px solid #1E383C', background: '#0E2226', boxShadow: '0 4px 16px rgba(0,0,0,0.4)', fontSize: 12, color: '#F5FAFA' }}
            itemStyle={{ color: '#F5FAFA' }}
            formatter={(value: number) => [`${value} ${unit}`, '']}
          />
          <Line type="monotone" dataKey={dataKey} stroke="#00D7F5" strokeWidth={2.5} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
