import { useEffect, useState } from 'react';
import { api } from '../api';
import { applyTimeRange, defaultTimeRange, type TimeRange } from '../timeRange';
import type { EventRecord, Paginated } from '../types';
import { Pagination } from './Pagination';
import { TimeRangeFilter } from './TimeRangeFilter';

interface LiveStreamProps {
  onUnauthorized: () => void;
}

const PAGE_SIZE = 15;

export function LiveStream({ onUnauthorized }: LiveStreamProps) {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('');
  const [tag, setTag] = useState('');
  const [range, setRange] = useState<TimeRange>(defaultTimeRange);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);

  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  async function deleteSelected() {
    if (!window.confirm(`Delete ${selected.size} selected event(s)?`)) return;
    try {
      await api('/api/events/bulk-delete', { method: 'POST', body: JSON.stringify({ ids: [...selected] }) });
      setSelected(new Set());
      setReloadKey((key) => key + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete events');
    }
  }

  const allSelected = events.length > 0 && events.every((event) => selected.has(event.id));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
        if (search.trim()) params.set('search', search.trim());
        if (level) params.set('level', level);
        if (/^[^=]+=.+$/.test(tag.trim())) params.set('tag', tag.trim());
        applyTimeRange(params, range);
        const result = await api<Paginated<EventRecord>>(`/api/events?${params}`);
        if (!active) return;
        if (result.items.length === 0 && result.total > 0 && page > 1) {
          setPage(Math.ceil(result.total / PAGE_SIZE));
          return;
        }
        setEvents(result.items);
        setTotal(result.total);
        setError('');
        setUpdatedAt(new Date());
      } catch (cause) {
        if (!active) return;
        const message = cause instanceof Error ? cause.message : 'Unable to load events';
        if (message.includes('Unauthorized') || message.includes('Session expired')) onUnauthorized();
        else setError(message);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [search, level, tag, range, page, reloadKey, onUnauthorized]);

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        <div>
          <h2 className="font-medium">Incoming events</h2>
          <p className="mt-1 text-xs text-zinc-500">{updatedAt ? `Updated ${updatedAt.toLocaleTimeString()} · refreshes every 5 seconds` : 'Connecting…'}</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
          <select className="filter-select" aria-label="Filter by level" value={level} onChange={(event) => resetPage(setLevel)(event.target.value)}>
            <option value="">All levels</option>
            {['debug', 'info', 'warn', 'error', 'fatal'].map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <TimeRangeFilter value={range} onChange={resetPage(setRange)} />
          <input
            aria-label="Filter by tag"
            className="w-44 rounded-lg border border-line bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-sky-500"
            placeholder="Tag, e.g. build_type=debug"
            value={tag}
            onChange={(event) => resetPage(setTag)(event.target.value)}
          />
          <input
            aria-label="Search live events"
            className="w-full max-w-sm rounded-lg border border-line bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-sky-500 sm:w-64"
            placeholder="Filter messages and stack traces"
            value={search}
            onChange={(event) => resetPage(setSearch)(event.target.value)}
          />
        </div>
      </div>
      {selected.size > 0 && (
        <div className="flex items-center justify-between border-b border-line bg-sky-950/20 px-4 py-2 text-sm">
          <span className="text-zinc-300">{selected.size} selected</span>
          <button className="action-button danger" onClick={() => void deleteSelected()}>Delete selected</button>
        </div>
      )}
      {error && <p className="border-b border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-zinc-500">
            <tr><th className="w-10 px-5 py-3"><input type="checkbox" aria-label="Select all events" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(events.map((event) => event.id)))} /></th><th className="px-2 py-3 font-medium">Time</th><th className="px-4 py-3 font-medium">Level</th><th className="px-4 py-3 font-medium">Service</th><th className="px-4 py-3 font-medium">Message</th><th className="px-4 py-3 font-medium">Issue</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {events.map((event) => (
              <tr key={event.id}>
                <td className="px-5 py-3"><input type="checkbox" aria-label="Select event" checked={selected.has(event.id)} onChange={() => toggle(event.id)} /></td>
                <td className="whitespace-nowrap px-2 py-3 text-xs text-zinc-500">{new Date(event.created_at).toLocaleTimeString()}</td>
                <td className="px-4 py-3"><span className={`level-tag ${event.level}`}>{event.level}</span></td>
                <td className="px-4 py-3 text-zinc-300">{event.service}</td>
                <td className="max-w-md truncate px-4 py-3 text-zinc-200" title={event.message}>{event.message}</td>
                <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-zinc-500" title={event.issue_id}>{event.issue_title ?? event.issue_id}</td>
              </tr>
            ))}
            {events.length === 0 && <tr><td colSpan={6} className="px-5 py-14 text-center text-zinc-500">No matching events</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
    </section>
  );
}
