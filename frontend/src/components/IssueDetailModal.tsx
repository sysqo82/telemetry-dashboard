import { useEffect, useState } from 'react';
import { api } from '../api';
import { eventJson } from '../eventJson';
import type { EventRecord, Issue } from '../types';

interface IssueDetailModalProps {
  issue: Issue;
  filters: { tag?: string; search?: string };
  onClose: () => void;
  onDeleted: () => void;
}

function prettyJson(value: string | null) {
  if (!value) return '—';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export function IssueDetailModal({ issue, filters, onClose, onDeleted }: IssueDetailModalProps) {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState('');
  const [copiedId, setCopiedId] = useState('');

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.tag) params.set('tag', filters.tag);
    if (filters.search) params.set('search', filters.search);
    const query = params.toString();
    api<{ issue: Issue; events: EventRecord[] }>(`/api/issues/${encodeURIComponent(issue.id)}${query ? `?${query}` : ''}`)
      .then((result) => setEvents(result.events))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load issue details'))
      .finally(() => setLoading(false));
  }, [issue.id, filters.tag, filters.search]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function deleteIssue() {
    if (!window.confirm('Delete this issue and all associated events?')) return;
    try {
      await api(`/api/issues/${encodeURIComponent(issue.id)}`, { method: 'DELETE' });
      onDeleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete issue');
    }
  }

  async function copyEvent(event: EventRecord) {
    setError('');
    setNotice('');
    try {
      await navigator.clipboard.writeText(eventJson(event));
      setCopiedId(event.id);
      setTimeout(() => setCopiedId((current) => (current === event.id ? '' : current)), 1500);
    } catch (cause) {
      setError(cause instanceof Error ? `Unable to copy event: ${cause.message}` : 'Unable to copy event.');
    }
  }

  function exportSelected() {
    setError('');
    setNotice('');
    try {
      const json = eventJson(events.filter((event) => selected.has(event.id)));
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = `events-${issue.id}.json`;
        link.click();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (cause) {
      setError(cause instanceof Error ? `Unable to export events: ${cause.message}` : 'Unable to export events.');
    }
  }

  const allSelected = events.length > 0 && events.every((event) => selected.has(event.id));

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-10 backdrop-blur-sm" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="issue-title" className="w-full max-w-4xl rounded-xl border border-line bg-panel shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-line p-5">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-sky-400">{issue.service} · {issue.status}</p>
            <h2 id="issue-title" className="mt-2 break-words text-lg font-semibold">{issue.title}</h2>
            {issue.culprit && issue.culprit !== 'unknown' && (
              <p className="mt-1 break-all font-mono text-xs text-zinc-500">{issue.culprit}</p>
            )}
          </div>
          <button aria-label="Close details" className="rounded-md px-2 py-1 text-zinc-400 hover:bg-white/10" onClick={onClose}>✕</button>
        </header>
        <div className="space-y-4 p-5">
          {(filters.tag || filters.search) && (
            <p className="text-sm text-zinc-400">Showing up to 50 events matching the active {filters.tag && filters.search ? 'search and attribute filters' : filters.tag ? 'attribute filter' : 'search'}.</p>
          )}
          {error && <p role="alert" className="rounded-lg bg-red-950/40 p-3 text-sm text-red-300">{error}</p>}
          {notice && <p role="status" className="text-sm text-zinc-300">{notice}</p>}
          {loading && <p className="text-sm text-zinc-400">Loading events…</p>}
          {!loading && !error && events.length === 0 && <p className="text-sm text-zinc-500">{filters.tag || filters.search ? 'No matching events.' : 'No event details.'}</p>}
          {events.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(events.map((event) => event.id)))} />
                Select all displayed events
              </label>
              <button className="action-button" disabled={selected.size === 0} onClick={exportSelected}>Export selected ({selected.size})</button>
            </div>
          )}
          {events.map((event) => {
            const frames = event.stacktrace?.split('\n') ?? [];
            const appFrames = frames.filter((frame) => !frame.includes('node_modules'));
            const libraryFrames = frames.filter((frame) => frame.includes('node_modules'));
            return (
              <article key={event.id} className="rounded-lg border border-line bg-zinc-950/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" aria-label={`Select event ${event.id}`} checked={selected.has(event.id)} onChange={() => setSelected((current) => {
                      const next = new Set(current);
                      if (!next.delete(event.id)) next.add(event.id);
                      return next;
                    })} />
                    <span className={`level-tag ${event.level}`}>{event.level}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <time className="text-xs text-zinc-500">{new Date(event.created_at).toLocaleString('en-GB')}</time>
                    <button className="action-button" aria-label={`Copy event ${event.id} as JSON`} onClick={() => void copyEvent(event)}>{copiedId === event.id ? 'Copied' : 'Copy JSON'}</button>
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm text-zinc-200">{event.message}</p>
                {appFrames.length > 0 && <pre className="mt-3 overflow-x-auto rounded-md bg-black/40 p-3 text-xs leading-5 text-zinc-300">{appFrames.join('\n')}</pre>}
                {libraryFrames.length > 0 && (
                  <details className="mt-2 text-xs text-zinc-400">
                    <summary className="cursor-pointer select-none">Show {libraryFrames.length} node_modules frame(s)</summary>
                    <pre className="mt-2 overflow-x-auto rounded-md bg-black/40 p-3 leading-5">{libraryFrames.join('\n')}</pre>
                  </details>
                )}
                <details className="mt-3">
                  <summary className="cursor-pointer select-none text-xs text-zinc-400">Event payload</summary>
                  <div className="mt-2 grid gap-3 md:grid-cols-2">
                    <pre className="overflow-x-auto rounded-md bg-black/40 p-3 text-xs text-zinc-300"><span className="text-zinc-500">tags</span>{'\n'}{prettyJson(event.tags)}</pre>
                    <pre className="overflow-x-auto rounded-md bg-black/40 p-3 text-xs text-zinc-300"><span className="text-zinc-500">metadata</span>{'\n'}{prettyJson(event.metadata)}</pre>
                  </div>
                </details>
              </article>
            );
          })}
        </div>
        <footer className="flex justify-between border-t border-line p-4">
          <button className="action-button danger" onClick={() => void deleteIssue()}>Delete issue</button>
          <button className="action-button" onClick={onClose}>Close</button>
        </footer>
      </section>
    </div>
  );
}
