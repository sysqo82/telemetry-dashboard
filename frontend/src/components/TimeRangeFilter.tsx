import { presetOptions, type RangePreset, type TimeRange } from '../timeRange';

interface TimeRangeFilterProps {
  value: TimeRange;
  onChange: (value: TimeRange) => void;
}

const dateInput = 'rounded-lg border border-line bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-sky-500 [color-scheme:dark]';

export function TimeRangeFilter({ value, onChange }: TimeRangeFilterProps) {
  return (
    <>
      <select
        className="filter-select"
        aria-label="Filter by timeframe"
        value={value.preset}
        onChange={(event) => onChange({ ...value, preset: event.target.value as RangePreset })}
      >
        {presetOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {value.preset === 'custom' && (
        <>
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            From
            <input
              type="datetime-local"
              aria-label="From date"
              className={dateInput}
              value={value.from}
              max={value.to || undefined}
              onChange={(event) => onChange({ ...value, from: event.target.value })}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            To
            <input
              type="datetime-local"
              aria-label="To date"
              className={dateInput}
              value={value.to}
              min={value.from || undefined}
              onChange={(event) => onChange({ ...value, to: event.target.value })}
            />
          </label>
        </>
      )}
    </>
  );
}
