import { useEffect, useState } from 'react';
import { api } from '../api';
import type { EventRecord, Issue } from '../types';

interface IssueDetailModalProps {
  issue: Issue;
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

export function IssueDetailModal({ issue, onClose, onDeleted }: IssueDetailModalProps) {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ issue: Issue; events: EventRecord[] }>(`/api/issues/${encodeURIComponent(issue.id)}`)
      .then((result) => setEvents(result.events))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load issue details'))
      .finally(() => setLoading(false));
  }, [issue.id]);

  async function deleteIssue() {
    if (!window.confirm('Delete this issue and all associated events?')) return;
    try {
      await api(`/api/issues/${encodeURIComponent(issue.id)}`, { method: 'DELETE' });
      onDeleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete issue');
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-10 backdrop-blur-sm" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="issue-title" className="w-full max-w-4xl rounded-xl border border-line bg-panel shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-line p-5">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-sky-400">{issue.service} · {issue.status}</p>
            <h2 id="issue-title" className="mt-2 break-words text-lg font-semibold">{issue.title}</h2>
            <p className="mt-1 break-all font-mono text-xs text-zinc-500">{issue.culprit ?? issue.id}</p>
          </div>
          <button aria-label="Close details" className="rounded-md px-2 py-1 text-zinc-400 hover:bg-white/10" onClick={onClose}>✕</button>
        </header>
        <div className="space-y-4 p-5">
          {error && <p className="rounded-lg bg-red-950/40 p-3 text-sm text-red-300">{error}</p>}
          {loading && <p className="text-sm text-zinc-400">Loading events…</p>}
          {!loading && events.length === 0 && <p className="text-sm text-zinc-500">No event details.</p>}
          {events.map((event) => {
            const frames = event.stacktrace?.split('\n') ?? [];
            const appFrames = frames.filter((frame) => !frame.includes('node_modules'));
            const libraryFrames = frames.filter((frame) => frame.includes('node_modules'));
            return (
              <article key={event.id} className="rounded-lg border border-line bg-zinc-950/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`level-tag ${event.level}`}>{event.level}</span>
                  <time className="text-xs text-zinc-500">{new Date(event.created_at).toLocaleString()}</time>
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
