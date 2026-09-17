export function ProgressRing({
  percent,
  size = 96,
  strokeWidth = 10,
  gradientId = 'progressRingGradient',
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
  gradientId?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = circumference - (clamped / 100) * circumference;

  return (
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
        style={{
          transition: 'stroke-dashoffset 0.7s cubic-bezier(0.34, 1.2, 0.64, 1)',
          filter: 'drop-shadow(0 0 6px rgba(0, 215, 245, 0.45))',
        }}
      />
    </svg>
  );
}
