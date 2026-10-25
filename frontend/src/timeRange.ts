export type RangePreset = 'all' | '5m' | '15m' | '30m' | '1h' | '24h' | 'custom';

export interface TimeRange {
  preset: RangePreset;
  from: string;
  to: string;
}

export const defaultTimeRange: TimeRange = { preset: 'all', from: '', to: '' };

export const presetOptions: { value: RangePreset; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: '5m', label: 'Last 5 minutes' },
  { value: '15m', label: 'Last 15 minutes' },
  { value: '30m', label: 'Last 30 minutes' },
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24 hours' },
  { value: 'custom', label: 'Custom range…' },
];

const presetMinutes: Record<string, number> = { '5m': 5, '15m': 15, '30m': 30, '1h': 60, '24h': 1440 };

function toIso(localValue: string): string | undefined {
  if (!localValue) return undefined;
  const time = new Date(localValue).getTime();
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

// Presets are relative to the moment of the request so periodic refreshes slide the window.
export function applyTimeRange(params: URLSearchParams, range: TimeRange, now = Date.now()) {
  if (range.preset === 'custom') {
    const from = toIso(range.from);
    const to = toIso(range.to);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
  } else if (range.preset !== 'all') {
    params.set('from', new Date(now - presetMinutes[range.preset] * 60_000).toISOString());
  }
}
