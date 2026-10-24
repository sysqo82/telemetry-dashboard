import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';

interface ApiKeyRecord {
  id: string;
  service: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

interface ApiKeysProps {
  onUnauthorized: () => void;
}

export function ApiKeys({ onUnauthorized }: ApiKeysProps) {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [service, setService] = useState('');
  const [created, setCreated] = useState<{ service: string; apiKey: string } | null>(null);
  const [error, setError] = useState('');

  function fail(cause: unknown, fallback: string) {
    const message = cause instanceof Error ? cause.message : fallback;
    if (message.includes('Unauthorized') || message.includes('Session expired')) onUnauthorized();
    else setError(message);
  }

  async function load() {
    try {
      setKeys(await api<ApiKeyRecord[]>('/api/keys'));
    } catch (cause) {
      fail(cause, 'Unable to load API keys');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const result = await api<{ service: string; apiKey: string }>('/api/keys', {
        method: 'POST',
        body: JSON.stringify({ service }),
      });
      setCreated({ service: result.service, apiKey: result.apiKey });
      setService('');
      await load();
    } catch (cause) {
      fail(cause, 'Unable to create API key');
    }
  }

  async function revoke(key: ApiKeyRecord) {
    if (!window.confirm(`Revoke the key ${key.key_prefix}… for "${key.service}"? Apps using it will be rejected.`)) return;
    try {
      await api(`/api/keys/${encodeURIComponent(key.id)}`, { method: 'DELETE' });
      await load();
    } catch (cause) {
      fail(cause, 'Unable to revoke API key');
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel">
      <form onSubmit={create} className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <input
          aria-label="Service name"
          required
          maxLength={100}
          className="min-w-48 flex-1 rounded-lg border border-line bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-sky-500"
          placeholder="Service name (must match the `service` your app sends)"
          value={service}
          onChange={(event) => setService(event.target.value)}
        />
        <button className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400">Create API key</button>
      </form>
      {created && (
        <div className="border-b border-emerald-900/60 bg-emerald-950/30 p-4 text-sm">
          <p className="text-emerald-300">Key for <strong>{created.service}</strong> — copy it now, it will not be shown again:</p>
          <code className="mt-2 block break-all rounded-md bg-black/40 p-3 font-mono text-xs text-zinc-200">{created.apiKey}</code>
          <button className="action-button mt-3" onClick={() => setCreated(null)}>Done</button>
        </div>
      )}
      {error && <p className="border-b border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-5 py-3 font-medium">Service</th>
              <th className="px-4 py-3 font-medium">Key</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Last used</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {keys.map((key) => (
              <tr key={key.id}>
                <td className="px-5 py-3 text-zinc-200">{key.service}</td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-400">{key.key_prefix}…</td>
                <td className="px-4 py-3 text-zinc-400">{new Date(key.created_at).toLocaleString()}</td>
                <td className="px-4 py-3 text-zinc-400">{key.last_used_at ? new Date(key.last_used_at).toLocaleString() : 'Never'}</td>
                <td className="px-4 py-3 text-right"><button className="action-button danger" onClick={() => void revoke(key)}>Revoke</button></td>
              </tr>
            ))}
            {keys.length === 0 && <tr><td colSpan={5} className="px-5 py-14 text-center text-zinc-500">No API keys yet</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
