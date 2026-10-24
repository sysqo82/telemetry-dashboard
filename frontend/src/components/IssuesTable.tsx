import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Issue } from '../types';
import { Sparkline } from './Sparkline';

interface IssuesTableProps {
  onSelect: (issue: Issue) => void;
  onUnauthorized: () => void;
}

const statuses = ['unresolved', 'resolved', 'ignored', 'all'] as const;

export function IssuesTable({ onSelect, onUnauthorized }: IssuesTableProps) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [status, setStatus] = useState<string>('unresolved');
  const [service, setService] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadIssues() {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ status });
    if (service) params.set('service', service);
    if (search.trim()) params.set('search', search.trim());
    try {
      const [results, serviceNames] = await Promise.all([
        api<Issue[]>(`/api/issues?${params}`),
        api<string[]>('/api/services'),
      ]);
      setIssues(results);
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
  }, [status, service, search]);

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

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <input
          aria-label="Search issues"
          className="min-w-48 flex-1 rounded-lg border border-line bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-sky-500"
          placeholder="Search messages and stack traces"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select className="filter-select" aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}>
          {statuses.map((item) => <option key={item} value={item}>{item === 'all' ? 'All statuses' : item}</option>)}
        </select>
        <select className="filter-select" aria-label="Filter by service" value={service} onChange={(event) => setService(event.target.value)}>
          <option value="">All services</option>
          {services.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
      {error && <p className="border-b border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-5 py-3 font-medium">Issue</th>
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
                <td className="max-w-[420px] px-5 py-4">
                  <button className="block truncate text-left font-medium text-zinc-100 hover:text-sky-300" onClick={() => onSelect(issue)}>
                    {issue.title}
                  </button>
                  <p className="mt-1 truncate font-mono text-xs text-zinc-500">{issue.culprit ?? issue.id}</p>
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
              <tr><td colSpan={6} className="px-5 py-16 text-center text-zinc-500">No matching issues</td></tr>
            )}
            {loading && <tr><td colSpan={6} className="px-5 py-10 text-center text-zinc-500">Loading issues…</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
