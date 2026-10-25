interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

function pageList(page: number, pages: number): (number | 'gap')[] {
  const wanted = new Set([1, pages, page - 1, page, page + 1]);
  const sorted = [...wanted].filter((value) => value >= 1 && value <= pages).sort((a, b) => a - b);
  return sorted.flatMap((value, index) => (index > 0 && value - sorted[index - 1] > 1 ? ['gap' as const, value] : [value]));
}

export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-xs text-zinc-400">
      <span>{first}–{last} of {total}</span>
      <div className="flex items-center gap-1">
        <button className="action-button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</button>
        {pageList(page, pages).map((entry, index) => (entry === 'gap'
          ? <span key={`gap-${index}`} className="px-1">…</span>
          : (
            <button
              key={entry}
              aria-current={entry === page ? 'page' : undefined}
              className={`action-button ${entry === page ? 'border-sky-500 text-sky-300' : ''}`}
              onClick={() => onPageChange(entry)}
            >
              {entry}
            </button>
          )))}
        <button className="action-button" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>Next</button>
      </div>
    </nav>
  );
}
