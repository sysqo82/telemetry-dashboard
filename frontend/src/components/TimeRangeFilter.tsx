import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { customRangeError, presetOptions, type RangePreset, type TimeRange } from '../timeRange';

interface TimeRangeFilterProps {
  value: TimeRange;
  onChange: (value: TimeRange) => void;
}

const dateInput = 'w-full rounded-lg border border-line bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-sky-500 [color-scheme:dark]';

export function TimeRangeFilter({ value, onChange }: TimeRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ from: '', to: '' });
  const [error, setError] = useState('');
  const [position, setPosition] = useState<CSSProperties>({});
  const anchorRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fromRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const errorId = useId();

  function openPicker() {
    setDraft({ from: value.from, to: value.to });
    setError('');
    setOpen(true);
  }

  function closePicker() {
    setOpen(false);
    selectRef.current?.focus();
  }

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom;
      const above = rect.top;
      const showAbove = below < 300 && above > below;
      setPosition({
        width,
        left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
        ...(showAbove ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
        maxHeight: Math.max(80, (showAbove ? above : below) - 12),
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    fromRef.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target) && !anchorRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePicker();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = customRangeError(draft.from, draft.to);
    if (message) {
      setError(message);
      return;
    }
    onChange({ preset: 'custom', ...draft });
    closePicker();
  }

  return (
    <div ref={anchorRef} className="flex items-center gap-2">
      <select
        ref={selectRef}
        className="filter-select"
        aria-label="Filter by timeframe"
        value={open ? 'custom' : value.preset}
        onChange={(event) => {
          const preset = event.target.value as RangePreset;
          if (preset === 'custom') openPicker();
          else {
            setOpen(false);
            onChange({ preset, from: '', to: '' });
          }
        }}
      >
        {presetOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {value.preset === 'custom' && (
        <button type="button" className="action-button whitespace-nowrap" onClick={openPicker} aria-expanded={open}>
          Edit range
        </button>
      )}
      {open && createPortal(
        <div ref={panelRef} role="dialog" aria-labelledby={titleId} style={position} className="fixed z-30 overflow-y-auto rounded-xl border border-line bg-panel p-4 shadow-xl">
          <form onSubmit={apply} noValidate>
            <h3 id={titleId} className="mb-1 text-sm font-medium text-zinc-100">Custom range</h3>
            <p className="mb-3 text-xs text-zinc-400">Enter a start, an end, or both. Times are local.</p>
            <div className="space-y-3">
              <label className="block text-xs text-zinc-400">
                <span className="mb-1 block">From</span>
                <input ref={fromRef} type="datetime-local" className={dateInput} value={draft.from} onChange={(event) => { setDraft({ ...draft, from: event.target.value }); setError(''); }} aria-describedby={error ? errorId : undefined} />
              </label>
              <label className="block text-xs text-zinc-400">
                <span className="mb-1 block">To</span>
                <input type="datetime-local" className={dateInput} value={draft.to} onChange={(event) => { setDraft({ ...draft, to: event.target.value }); setError(''); }} aria-describedby={error ? errorId : undefined} />
              </label>
            </div>
            {error && <p id={errorId} role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="action-button" onClick={closePicker}>Cancel</button>
              <button type="submit" className="action-button border-sky-700 text-sky-300">Apply</button>
            </div>
          </form>
        </div>,
        document.body,
      )}
    </div>
  );
}
