import { useEffect, useState } from 'react';
import { api } from '../api';
import { applyTimeRange, defaultTimeRange, type TimeRange } from '../timeRange';
import type { Issue, Paginated } from '../types';
import { Pagination } from './Pagination';
import { Sparkline } from './Sparkline';
import { TimeRangeFilter } from './TimeRangeFilter';

interface IssuesTableProps {
  onSelect: (issue: Issue) => void;
  onUnauthorized: () => void;
}

const statuses = ['unresolved', 'resolved', 'ignored', 'all'] as const;
const levels = ['debug', 'info', 'warn', 'error', 'fatal'] as const;
const PAGE_SIZE = 15;

export function IssuesTable({ onSelect, onUnauthorized }: IssuesTableProps) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [services, setServices] = useState<string[]>([]);
  const [status, setStatus] = useState<string>('unresolved');
  const [service, setService] = useState('');
  const [level, setLevel] = useState('');
  const [tag, setTag] = useState('');
  const [search, setSearch] = useState('');
  const [range, setRange] = useState<TimeRange>(defaultTimeRange);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  async function loadIssues() {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ status, page: String(page), pageSize: String(PAGE_SIZE) });
    if (service) params.set('service', service);
    if (level) params.set('level', level);
    if (/^[^=]+=.+$/.test(tag.trim())) params.set('tag', tag.trim());
    if (search.trim()) params.set('search', search.trim());
    applyTimeRange(params, range);
    try {
      const [result, serviceNames] = await Promise.all([
        api<Paginated<Issue>>(`/api/issues?${params}`),
        api<string[]>('/api/services'),
      ]);
      // A deletion can leave the current page empty; step back to the last page that still has rows.
      if (result.items.length === 0 && result.total > 0 && page > 1) {
        setPage(Math.ceil(result.total / PAGE_SIZE));
        return;
      }
      setIssues(result.items);
      setTotal(result.total);
      setSelected((current) => new Set([...current].filter((id) => result.items.some((issue) => issue.id === id))));
      setServices(serviceNames);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to load issues';
      if (message.includes('Unauthorized') || message.includes('Session expired')) onUnauthorized();
      else setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadIssues(), 180);
    return () => window.clearTimeout(timer);
  }, [status, service, level, tag, search, range, page]);

  async function updateStatus(issue: Issue, nextStatus: 'resolved' | 'ignored') {
    try {
      await api(`/api/issues/${encodeURIComponent(issue.id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      await loadIssues();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update issue');
    }
  }

  async function deleteSelected() {
    if (!window.confirm(`Delete ${selected.size} selected issue(s) and all their events?`)) return;
    try {
      await api('/api/issues/bulk-delete', { method: 'POST', body: JSON.stringify({ ids: [...selected] }) });
      await loadIssues();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete issues');
    }
  }

  const allSelected = issues.length > 0 && issues.every((issue) => selected.has(issue.id));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel">
      {selected.size > 0 && (
        <div className="flex items-center justify-between border-b border-line bg-sky-950/20 px-4 py-2 text-sm">
          <span className="text-zinc-300">{selected.size} selected</span>
          <button className="action-button danger" onClick={() => void deleteSelected()}>Delete selected</button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <input
          aria-label="Search issues"
          className="min-w-48 flex-1 rounded-lg border border-line bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-sky-500"
          placeholder="Search messages and stack traces"
          value={search}
          onChange={(event) => resetPage(setSearch)(event.target.value)}
        />
        <select className="filter-select" aria-label="Filter by status" value={status} onChange={(event) => resetPage(setStatus)(event.target.value)}>
          {statuses.map((item) => <option key={item} value={item}>{item === 'all' ? 'All statuses' : item}</option>)}
        </select>
        <select className="filter-select" aria-label="Filter by service" value={service} onChange={(event) => resetPage(setService)(event.target.value)}>
          <option value="">All services</option>
          {services.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select className="filter-select" aria-label="Filter by level" value={level} onChange={(event) => resetPage(setLevel)(event.target.value)}>
          <option value="">All levels</option>
          {levels.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <input
          aria-label="Filter by tag"
          className="w-44 rounded-lg border border-line bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-sky-500"
          placeholder="Tag, e.g. build_type=debug"
          value={tag}
          onChange={(event) => resetPage(setTag)(event.target.value)}
        />
        <TimeRangeFilter value={range} onChange={resetPage(setRange)} />
      </div>
      {error && <p className="border-b border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="w-10 px-5 py-3"><input type="checkbox" aria-label="Select all issues" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(issues.map((issue) => issue.id)))} /></th>
              <th className="px-2 py-3 font-medium">Issue</th>
              <th className="px-4 py-3 font-medium">Service</th>
              <th className="px-4 py-3 font-medium">Level</th>
              <th className="px-4 py-3 font-medium">Events / 24h</th>
              <th className="px-4 py-3 font-medium">Last seen</th>
              <th className="px-4 py-3 font-medium">Triage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {issues.map((issue) => (
              <tr key={issue.id} className="hover:bg-white/[0.025]">
                <td className="px-5 py-4"><input type="checkbox" aria-label={`Select issue ${issue.title}`} checked={selected.has(issue.id)} onChange={() => toggle(issue.id)} /></td>
                <td className="w-[40%] max-w-0 px-2 py-4">
                  <button className="block w-full truncate text-left font-medium text-zinc-100 hover:text-sky-300" onClick={() => onSelect(issue)}>
                    {issue.title}
                  </button>
                  {issue.culprit && issue.culprit !== 'unknown' && (
                    <p className="mt-1 truncate font-mono text-xs text-zinc-500">{issue.culprit}</p>
                  )}
                </td>
                <td className="px-4 py-4 text-zinc-300">{issue.service}</td>
                <td className="px-4 py-4"><span className={`level-tag ${issue.latest_level ?? 'error'}`}>{issue.latest_level ?? 'error'}</span></td>
                <td className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <span className="w-8 tabular-nums text-zinc-300">{issue.occurrence_count}</span>
                    <Sparkline timestamps={issue.recent_timestamps} />
                  </div>
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-zinc-400">{new Date(issue.last_seen_at).toLocaleString()}</td>
                <td className="px-4 py-4">
                  <div className="flex gap-2">
                    {issue.status !== 'resolved' && <button className="action-button" onClick={() => void updateStatus(issue, 'resolved')}>Resolve</button>}
                    {issue.status !== 'ignored' && <button className="action-button" onClick={() => void updateStatus(issue, 'ignored')}>Ignore</button>}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && issues.length === 0 && (
              <tr><td colSpan={7} className="px-5 py-16 text-center text-zinc-500">No matching issues</td></tr>
            )}
            {loading && <tr><td colSpan={7} className="px-5 py-10 text-center text-zinc-500">Loading issues…</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
    </section>
  );
}
