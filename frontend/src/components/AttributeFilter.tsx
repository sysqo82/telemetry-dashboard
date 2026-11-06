import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { ClearButton } from './ClearButton';

interface AttributeFilterProps {
  value: string;
  onChange: (value: string) => void;
  onUnauthorized: () => void;
  view?: 'issues' | 'events';
}

interface Suggestion {
  value: string;
  statuses: string[];
}

export function AttributeFilter({ value, onChange, onUnauthorized, view = 'events' }: AttributeFilterProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [listStyle, setListStyle] = useState<CSSProperties>({});
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState('');
  const visible = focused && open && suggestions.length > 0;

  useLayoutEffect(() => {
    if (!visible) return;
    const positionList = () => {
      const input = inputRef.current;
      if (!input) return;
      const rect = input.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom;
      const above = rect.top;
      const showAbove = below < 160 && above > below;
      setListStyle({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        width,
        ...(showAbove ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
        maxHeight: Math.max(40, Math.min(240, (showAbove ? above : below) - 12)),
      });
    };
    positionList();
    window.addEventListener('resize', positionList);
    window.addEventListener('scroll', positionList, true);
    return () => {
      window.removeEventListener('resize', positionList);
      window.removeEventListener('scroll', positionList, true);
    };
  }, [visible]);

  useEffect(() => {
    if (visible && activeIndex >= 0) {
      document.getElementById(`${listId}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, listId, visible]);

  useEffect(() => {
    if (!focused) return;
    let active = true;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: value.trim(), view });
      void api<(string | Suggestion)[]>(`/api/filter-suggestions?${params}`)
        .then((result) => {
          if (!active) return;
          setSuggestions(result.map((item) => typeof item === 'string' ? { value: item, statuses: [] } : item));
          setActiveIndex(-1);
          setError('');
        })
        .catch((cause: unknown) => {
          if (!active) return;
          const message = cause instanceof Error ? cause.message : 'Unable to load filter suggestions';
          if (message.includes('Unauthorized') || message.includes('Session expired')) onUnauthorized();
          else setError(message);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [focused, value, onUnauthorized, view]);

  function selectSuggestion(suggestion: string) {
    onChange(suggestion);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActiveIndex(-1);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => event.key === 'ArrowDown'
        ? Math.min(current + 1, suggestions.length - 1)
        : current <= 0 ? suggestions.length - 1 : current - 1);
    } else if (event.key === 'Enter' && visible && activeIndex >= 0) {
      event.preventDefault();
      selectSuggestion(suggestions[activeIndex].value);
    }
  }

  return (
    <div>
      <div className="relative w-44">
        <input
          ref={inputRef}
          aria-label="Filter by tag or metadata"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={visible}
          aria-controls={visible ? listId : undefined}
          aria-activedescendant={visible && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
          autoComplete="off"
          className="w-full rounded-lg border border-line bg-zinc-950 px-3 py-2 pr-10 text-sm outline-none focus:border-sky-500"
          placeholder="Tag or metadata key=value"
          maxLength={300}
          value={value}
          onChange={(event) => {
            setSuggestions([]);
            setActiveIndex(-1);
            setOpen(true);
            onChange(event.target.value);
          }}
          onFocus={() => {
            setFocused(true);
            setOpen(true);
          }}
          onBlur={() => {
            setFocused(false);
            setOpen(false);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
        />
        {value && <ClearButton label="Clear tag or metadata filter" onClear={() => {
          setSuggestions([]);
          setActiveIndex(-1);
          onChange('');
          inputRef.current?.focus();
          setOpen(false);
        }} />}
      </div>
      {visible && createPortal(
        <ul id={listId} role="listbox" aria-label="Filter suggestions" style={listStyle} className="fixed z-30 overflow-y-auto rounded-lg border border-line bg-zinc-950 py-1 text-sm shadow-xl">
          {suggestions.map((suggestion, index) => (
            <li
              id={`${listId}-option-${index}`}
              key={suggestion.value}
              role="option"
              aria-selected={index === activeIndex}
              className={`cursor-pointer break-all px-3 py-2 text-zinc-200 hover:bg-white/10 ${index === activeIndex ? 'bg-white/10' : ''}`}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => selectSuggestion(suggestion.value)}
            >
              {suggestion.value}
              {suggestion.statuses.length > 0 && (
                <span className="mt-1 block text-xs text-zinc-400">{suggestion.statuses.join(' · ')}</span>
              )}
            </li>
          ))}
        </ul>,
        document.body,
      )}
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
