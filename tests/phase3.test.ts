import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../src/db/index.js';
import { createAlertDispatcher } from '../src/services/alerts.js';
import { createIngestor } from '../src/services/ingestion.js';
import { runRetention } from '../src/services/retention.js';

const alert = {
  service: 'svc',
  fingerprint: 'same-fingerprint',
  title: 'Failure',
  culprit: 'run()',
  level: 'error',
  message: 'Something failed',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('alert dispatcher', () => {
  it('formats Discord alerts and suppresses repeats for the same fingerprint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const dispatch = createAlertDispatcher('https://discord.com/api/webhooks/123/secret');

    await dispatch(alert);
    await dispatch(alert);

    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(request.body as string);
    expect(body.embeds[0].title).toBe('[SVC] Failure');
    expect(body.embeds[0].description).toContain('Something failed');
  });

  it('sends ntfy headers and allows retry after a failed webhook response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dispatch = createAlertDispatcher('https://ntfy.sh/example-topic');

    await dispatch({ ...alert, level: 'fatal' });
    await dispatch({ ...alert, level: 'fatal' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(request.headers).get('Priority')).toBe('urgent');
    expect(request.body).toContain('Something failed');
  });

  it('sends generic JSON webhooks and ignores absent configuration', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await createAlertDispatcher()(alert);
    await createAlertDispatcher('https://hooks.example.test/alerts')(alert);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(alert);
  });
});

describe('retention', () => {
  it('deletes only expired events and updates the FTS index', () => {
    const db = openDb(':memory:');
    try {
      const ingest = createIngestor(db);
      const now = Date.parse('2026-10-24T10:00:00.000Z');
      const common = {
        service: 'svc',
        environment: 'production',
        level: 'error' as const,
        message: 'retention marker',
        exception: { type: 'Error' },
      };
      ingest({ ...common, timestamp: '2026-09-20T10:00:00.000Z' });
      ingest({ ...common, timestamp: '2026-10-20T10:00:00.000Z' });

      expect(runRetention(db, 30, now)).toBe(1);
      expect(db.prepare('SELECT COUNT(*) AS count FROM events').get()).toEqual({ count: 1 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM events_fts WHERE events_fts MATCH 'marker'").get()).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });

  it('rejects an invalid retention period', () => {
    const db = openDb(':memory:');
    try {
      expect(() => runRetention(db, 0)).toThrow('retentionDays must be a positive integer');
    } finally {
      db.close();
    }
  });
});

describe('alert ingestion policy', () => {
  it('dispatches only error and fatal events', () => {
    const db = openDb(':memory:');
    try {
      const onAlert = vi.fn();
      const ingest = createIngestor(db, onAlert);
      ingest({ service: 'svc', environment: 'production', message: 'ignored level', level: 'info' });
      ingest({ service: 'svc', environment: 'production', message: 'error level', level: 'error' });
      ingest({ service: 'svc', environment: 'production', message: 'fatal level', level: 'fatal' });

      expect(onAlert).toHaveBeenCalledTimes(2);
      expect(onAlert.mock.calls.map(([value]) => value.level)).toEqual(['error', 'fatal']);
    } finally {
      db.close();
    }
  });
});
