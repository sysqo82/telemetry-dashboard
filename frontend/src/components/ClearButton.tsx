interface ClearButtonProps {
  label: string;
  onClear: () => void;
}

export function ClearButton({ label, onClear }: ClearButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      className="absolute inset-y-0 right-1 flex w-8 items-center justify-center rounded-md text-lg text-zinc-400 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
      onClick={onClear}
    >
      ×
    </button>
  );
}
