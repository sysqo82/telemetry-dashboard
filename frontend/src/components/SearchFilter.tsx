import { useRef } from 'react';
import { ClearButton } from './ClearButton';

interface SearchFilterProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  className: string;
}

export function SearchFilter({ label, placeholder, value, onChange, className }: SearchFilterProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        aria-label={label}
        className="w-full rounded-lg border border-line bg-zinc-950 px-3 py-2 pr-10 text-sm outline-none focus:border-sky-500"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && <ClearButton label={`Clear ${label.toLowerCase()}`} onClear={() => {
        onChange('');
        inputRef.current?.focus();
      }} />}
    </div>
  );
}
