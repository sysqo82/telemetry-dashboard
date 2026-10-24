import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import { ApiKeys } from './components/ApiKeys';
import { IssueDetailModal } from './components/IssueDetailModal';
import { IssuesTable } from './components/IssuesTable';
import { LiveStream } from './components/LiveStream';
import type { Issue } from './types';

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      onLogin();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-line bg-panel p-7 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-sky-500/15 text-sky-300">TM</div>
          <div><h1 className="font-semibold">Telemetry Monitor</h1><p className="text-xs text-zinc-500">Administrator sign in</p></div>
        </div>
        <label className="mb-2 block text-sm text-zinc-300" htmlFor="username">Username</label>
        <input id="username" type="text" autoComplete="username" autoFocus required value={username} onChange={(event) => setUsername(event.target.value)} className="mb-4 w-full rounded-lg border border-line bg-zinc-950 px-3 py-2.5 outline-none focus:border-sky-500" />
        <label className="mb-2 block text-sm text-zinc-300" htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-lg border border-line bg-zinc-950 px-3 py-2.5 outline-none focus:border-sky-500" />
        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
        <button disabled={busy} className="mt-5 w-full rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [view, setView] = useState<'issues' | 'live' | 'keys'>('issues');
  const [selected, setSelected] = useState<Issue | null>(null);
  const [issuesRefresh, setIssuesRefresh] = useState(0);
  const [notice, setNotice] = useState('');
  const handleUnauthorized = useCallback(() => setAuthenticated(false), []);

  const checkSession = useCallback(async () => {
    try {
      await api('/api/auth/session');
      setAuthenticated(true);
      setNotice('');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Session check failed';
      if (message.includes('Unauthorized') || message.includes('Session expired')) setAuthenticated(false);
      else {
        setAuthenticated(false);
        setNotice(message);
      }
    }
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
      setAuthenticated(false);
      setSelected(null);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Unable to sign out');
    }
  }

  if (authenticated === null) {
    return <main className="grid min-h-screen place-items-center text-sm text-zinc-500">Checking session…</main>;
  }
  if (!authenticated) {
    return <><Login onLogin={() => void checkSession()} />{notice && <p role="alert" className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-red-950 px-4 py-2 text-sm text-red-200">{notice}</p>}</>;
  }

  const heading = {
    issues: { eyebrow: 'Triage', title: 'Issues', text: 'Search, inspect, and triage grouped errors.' },
    live: { eyebrow: 'Stream', title: 'Live event stream', text: 'Recent incoming events, refreshed automatically.' },
    keys: { eyebrow: 'Security', title: 'API keys', text: 'One key per service. Keys are shown once and stored hashed.' },
  }[view];

  return (
    <main className="min-h-screen">
      <header className="border-b border-line bg-zinc-950/80">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-sky-500/15 text-xs font-bold text-sky-300">TM</div>
            <div><h1 className="font-semibold tracking-tight">Telemetry Monitor</h1><p className="text-xs text-zinc-500">Error observability</p></div>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-line bg-panel p-1">
            <button className={`nav-button ${view === 'issues' ? 'selected' : ''}`} onClick={() => setView('issues')}>Issues</button>
            <button className={`nav-button ${view === 'live' ? 'selected' : ''}`} onClick={() => setView('live')}>Live events</button>
            <button className={`nav-button ${view === 'keys' ? 'selected' : ''}`} onClick={() => setView('keys')}>API keys</button>
          </div>
          <button className="action-button" onClick={() => void logout()}>Sign out</button>
        </div>
      </header>
      <section className="mx-auto max-w-7xl px-5 py-8">
        <div className="mb-6">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-sky-400">{heading.eyebrow}</p>
          <h2 className="mt-2 text-2xl font-semibold">{heading.title}</h2>
          <p className="mt-1 text-sm text-zinc-500">{heading.text}</p>
        </div>
        {notice && <p role="alert" className="mb-4 rounded-lg bg-red-950/40 p-3 text-sm text-red-300">{notice}</p>}
        {view === 'issues' && <IssuesTable key={issuesRefresh} onSelect={setSelected} onUnauthorized={handleUnauthorized} />}
        {view === 'live' && <LiveStream onUnauthorized={handleUnauthorized} />}
        {view === 'keys' && <ApiKeys onUnauthorized={handleUnauthorized} />}
      </section>
      {selected && <IssueDetailModal issue={selected} onClose={() => setSelected(null)} onDeleted={() => {
        setSelected(null);
        setIssuesRefresh((current) => current + 1);
      }} />}
    </main>
  );
}
