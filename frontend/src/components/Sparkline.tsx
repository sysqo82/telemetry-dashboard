interface SparklineProps {
  timestamps: string[];
  width?: number;
  height?: number;
}

export function Sparkline({ timestamps, width = 120, height = 28 }: SparklineProps) {
  if (!timestamps?.length) {
    return <div className="text-xs italic text-gray-500">No activity</div>;
  }

  const buckets = Array.from({ length: 12 }, () => 0);
  const windowMs = 2 * 60 * 60 * 1000;
  timestamps.forEach((timestamp) => {
    const age = Date.now() - new Date(timestamp).getTime();
    const bucket = 11 - Math.floor(age / windowMs);
    if (Number.isFinite(age) && bucket >= 0 && bucket < buckets.length) buckets[bucket]++;
  });

  const max = Math.max(...buckets, 1);
  const points = buckets.map((value, index) => {
    const x = (index / (buckets.length - 1)) * width;
    const y = height - (value / max) * (height - 6) - 3;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible" aria-label="Events in the last 24 hours">
      <polyline
        fill="none"
        stroke="#38BDF8"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}
