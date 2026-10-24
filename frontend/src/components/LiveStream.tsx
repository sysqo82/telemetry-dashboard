import { useEffect, useState } from 'react';
import { api } from '../api';
import type { EventRecord } from '../types';

interface LiveStreamProps {
  onUnauthorized: () => void;
}

export function LiveStream({ onUnauthorized }: LiveStreamProps) {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const params = new URLSearchParams();
        if (search.trim()) params.set('search', search.trim());
        const results = await api<EventRecord[]>(`/api/events${params.size ? `?${params}` : ''}`);
        if (active) {
          setEvents(results);
          setError('');
          setUpdatedAt(new Date());
        }
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
  }, [search, onUnauthorized]);

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        <div>
          <h2 className="font-medium">Incoming events</h2>
          <p className="mt-1 text-xs text-zinc-500">{updatedAt ? `Updated ${updatedAt.toLocaleTimeString()} · refreshes every 5 seconds` : 'Connecting…'}</p>
        </div>
        <input
          aria-label="Search live events"
          className="w-full max-w-sm rounded-lg border border-line bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-sky-500"
          placeholder="Filter messages and stack traces"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {error && <p className="border-b border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-zinc-500">
            <tr><th className="px-5 py-3 font-medium">Time</th><th className="px-4 py-3 font-medium">Level</th><th className="px-4 py-3 font-medium">Service</th><th className="px-4 py-3 font-medium">Message</th><th className="px-4 py-3 font-medium">Issue</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {events.map((event) => (
              <tr key={event.id}>
                <td className="whitespace-nowrap px-5 py-3 text-xs text-zinc-500">{new Date(event.created_at).toLocaleTimeString()}</td>
                <td className="px-4 py-3"><span className={`level-tag ${event.level}`}>{event.level}</span></td>
                <td className="px-4 py-3 text-zinc-300">{event.service}</td>
                <td className="max-w-md truncate px-4 py-3 text-zinc-200" title={event.message}>{event.message}</td>
                <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-zinc-500" title={event.issue_id}>{event.issue_title ?? event.issue_id}</td>
              </tr>
            ))}
            {events.length === 0 && <tr><td colSpan={5} className="px-5 py-14 text-center text-zinc-500">No matching events</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
