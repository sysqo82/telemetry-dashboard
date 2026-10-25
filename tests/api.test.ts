import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/index.js';
import { buildApp } from '../src/app.js';
import { hashKey } from '../src/routes/events.js';

const KEY = 'test-key-1234567890';

describe('api', () => {
  let db: Db;
  let app: ReturnType<typeof buildApp>;
  const post = (payload: unknown, key: string | undefined = KEY) =>
    app.inject({ method: 'POST', url: '/v1/events', payload: payload as object, headers: key ? { 'x-api-key': key } : {} });
  const event = { service: 'svc', message: 'boom', exception: { type: 'E', stacktrace: 'at f (/app/a.ts:1)' } };

  beforeEach(() => {
    db = openDb(':memory:');
    app = buildApp({
      PORT: 0,
      HOST: '127.0.0.1',
      ADMIN_USERNAME: 'test-admin',
      ADMIN_PASSWORD: 'test-admin-password',
      NODE_ENV: 'test',
      RETENTION_DAYS: 30,
      ALERT_WEBHOOK_URL: '',
      DB_PATH: ':memory:',
    }, db);
    db.prepare('INSERT INTO api_keys (id, service, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('key-1', 'svc', hashKey(KEY), KEY.slice(0, 11), new Date().toISOString());
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('rejects missing/wrong key', async () => {
    expect((await post(event, '')).statusCode).toBe(401);
    expect((await post(event, 'wrong')).statusCode).toBe(401);
  });
  it('rejects invalid payload', async () => {
    expect((await post({ service: 'x' })).statusCode).toBe(400);
  });
  it('rejects a key used for a different service and records last use', async () => {
    expect((await post({ ...event, service: 'other' })).statusCode).toBe(403);
    expect(db.prepare('SELECT last_used_at FROM api_keys').get()).toEqual({ last_used_at: null });
    expect((await post(event)).statusCode).toBe(202);
    expect((db.prepare('SELECT last_used_at FROM api_keys').get() as any).last_used_at).not.toBeNull();
  });
  it('requires username and password, and manages per-service keys', async () => {
    const login = (payload: object) => app.inject({ method: 'POST', url: '/api/auth/login', payload });
    expect((await login({ password: 'test-admin-password' })).statusCode).toBe(401);
    expect((await login({ username: 'wrong', password: 'test-admin-password' })).statusCode).toBe(401);
    expect((await login({ username: 'test-admin', password: 'wrong' })).statusCode).toBe(401);
    const ok = await login({ username: 'test-admin', password: 'test-admin-password' });
    expect(ok.statusCode).toBe(200);
    const cookie = String(ok.headers['set-cookie']).split(';')[0];
    const headers = { cookie };

    expect((await app.inject({ method: 'GET', url: '/api/keys' })).statusCode).toBe(401);
    const created = await app.inject({ method: 'POST', url: '/api/keys', headers, payload: { service: 'new-app' } });
    expect(created.statusCode).toBe(201);
    const { id, apiKey } = created.json();
    expect(apiKey).toMatch(/^tm_[0-9a-f]{64}$/);
    expect(JSON.stringify(db.prepare('SELECT * FROM api_keys').all())).not.toContain(apiKey);

    expect((await post({ ...event, service: 'new-app' }, apiKey)).statusCode).toBe(202);
    const list = await app.inject({ method: 'GET', url: '/api/keys', headers });
    expect(list.json()).toHaveLength(2);
    expect(JSON.stringify(list.json())).not.toContain(apiKey);

    expect((await app.inject({ method: 'DELETE', url: `/api/keys/${id}`, headers })).json()).toEqual({ status: 'revoked', id });
    expect((await post({ ...event, service: 'new-app' }, apiKey)).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: `/api/keys/${id}`, headers })).statusCode).toBe(404);
  });
  it('dedupes into one issue, counts, reopens resolved', async () => {
    expect((await post(event)).statusCode).toBe(202);
    await post(event);
    db.prepare("UPDATE issues SET status='resolved'").run();
    await post(event);
    const issues = db.prepare('SELECT * FROM issues').all() as any[];
    expect(issues).toHaveLength(1);
    expect(issues[0].occurrence_count).toBe(3);
    expect(issues[0].status).toBe('unresolved');
    expect(db.prepare('SELECT COUNT(*) c FROM events').get()).toEqual({ c: 3 });
  });
  it('indexes events in FTS5', async () => {
    await post({ ...event, message: 'unique-needle here' });
    expect(db.prepare("SELECT COUNT(*) c FROM events_fts WHERE events_fts MATCH 'needle'").get()).toEqual({ c: 1 });
  });
  it('returns usable culprits and hides legacy unknown values in the issues API', async () => {
    await post({
      ...event,
      message: 'application frame event',
      exception: { type: 'AppError', stacktrace: 'at run (/app/src.ts:42)' },
    });
    await post({ service: 'svc', message: 'no stack trace event' });
    await post({
      ...event,
      message: 'library only event',
      exception: { type: 'LibraryError', stacktrace: 'at call (/app/node_modules/lib/index.js:12)' },
    });
    await post({ service: 'svc', message: 'legacy unknown event' });
    db.prepare("UPDATE issues SET culprit = 'unknown' WHERE title = 'legacy unknown event'").run();

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'test-admin', password: 'test-admin-password' },
    });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const response = await app.inject({ method: 'GET', url: '/api/issues?status=all', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const issues = response.json().items as Array<{ id: string; title: string; culprit: string }>;
    expect(issues.find(({ title }) => title === 'AppError: application frame event')?.culprit).toBe('run (/app/src.ts:42)');
    expect(issues.find(({ title }) => title === 'no stack trace event')?.culprit).toBe('');
    expect(issues.find(({ title }) => title === 'LibraryError: library only event')?.culprit).toBe('');
    const legacyIssue = issues.find(({ title }) => title === 'legacy unknown event');
    expect(legacyIssue?.culprit).toBe('');
    const details = await app.inject({
      method: 'GET',
      url: `/api/issues/${encodeURIComponent(legacyIssue?.id ?? '')}`,
      headers: { cookie },
    });
    expect(details.json().issue.culprit).toBe('');
  });
  it('healthz works without auth', async () => {
    const r = await app.inject({ method: 'GET', url: '/healthz' });
    expect(r.statusCode).toBe(200);
    expect(r.json().database).toBe('ok');
  });

  describe('time range and pagination', () => {
    const names = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
    const at = (hour: number) => `2026-01-01T${String(hour).padStart(2, '0')}:00:00.000Z`;
    let headers: { cookie: string };

    beforeEach(async () => {
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'test-admin', password: 'test-admin-password' },
      });
      headers = { cookie: String(login.headers['set-cookie']).split(';')[0] };
      for (const [index, name] of names.entries()) {
        await post({ service: 'svc', message: name, timestamp: at(10 + index) });
      }
    });

    const get = (url: string) => app.inject({ method: 'GET', url, headers });
    const titles = (body: { items: Array<{ title?: string; message?: string }> }) =>
      body.items.map((item) => item.title ?? item.message);

    it('pages issues with the latest first and reports totals', async () => {
      const first = (await get('/api/issues?status=all&pageSize=2&page=1')).json();
      expect(titles(first)).toEqual(['echo', 'delta']);
      expect(first).toMatchObject({ total: 5, page: 1, pageSize: 2 });
      expect(titles((await get('/api/issues?status=all&pageSize=2&page=3')).json())).toEqual(['alpha']);
      expect((await get('/api/issues?status=all&pageSize=2&page=4')).json().items).toEqual([]);
    });

    it('defaults to 15 rows per page', async () => {
      expect((await get('/api/issues?status=all')).json()).toMatchObject({ page: 1, pageSize: 15, total: 5 });
      expect((await get('/api/events')).json()).toMatchObject({ page: 1, pageSize: 15, total: 5 });
    });

    it('pages events with the latest first and reports totals', async () => {
      const second = (await get('/api/events?pageSize=2&page=2')).json();
      expect(titles(second)).toEqual(['charlie', 'bravo']);
      expect(second).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    });

    it('filters issues and events by from/to inclusive', async () => {
      const range = `from=${encodeURIComponent(at(11))}&to=${encodeURIComponent(at(13))}`;
      expect(titles((await get(`/api/issues?status=all&${range}`)).json())).toEqual(['delta', 'charlie', 'bravo']);
      expect(titles((await get(`/api/events?${range}`)).json())).toEqual(['delta', 'charlie', 'bravo']);
      expect((await get(`/api/issues?status=all&from=${encodeURIComponent('2026-01-01T12:30:00.000Z')}`)).json().total).toBe(2);
      expect((await get(`/api/events?to=${encodeURIComponent('2026-01-01T10:30:00.000Z')}`)).json().total).toBe(1);
    });

    it('reports the filtered total when combined with other filters and paging', async () => {
      const result = (await get(`/api/events?pageSize=1&from=${encodeURIComponent(at(12))}&search=delta`)).json();
      expect(titles(result)).toEqual(['delta']);
      expect(result.total).toBe(1);
    });

    it('rejects invalid paging and range parameters', async () => {
      for (const query of ['page=0', 'pageSize=0', 'pageSize=101', 'page=abc', 'from=yesterday', 'to=nonsense']) {
        expect((await get(`/api/issues?${query}`)).statusCode, query).toBe(400);
        expect((await get(`/api/events?${query}`)).statusCode, query).toBe(400);
      }
      const reversed = `from=${encodeURIComponent(at(13))}&to=${encodeURIComponent(at(11))}`;
      expect((await get(`/api/issues?${reversed}`)).statusCode).toBe(400);
      expect((await get(`/api/events?${reversed}`)).statusCode).toBe(400);
    });
  });

  it('serves the dashboard with SPA fallback and JSON API 404s', async () => {
    const root = await app.inject({ method: 'GET', url: '/' });
    expect(root.statusCode).toBe(200);
    expect(root.headers['content-type']).toContain('text/html');
    expect(root.body).toContain('<title>Telemetry Monitor</title>');

    const missingApiRoute = await app.inject({ method: 'GET', url: '/api/no-such-route' });
    expect(missingApiRoute.statusCode).toBe(404);
    expect(missingApiRoute.json()).toEqual({ error: 'Not Found' });

    const spaRoute = await app.inject({ method: 'GET', url: '/dashboard/issues' });
    expect(spaRoute.statusCode).toBe(200);
    expect(spaRoute.body).toContain('<title>Telemetry Monitor</title>');
  });

  it('authenticates dashboard access and supports issue search, triage, and deletion', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/issues' })).statusCode).toBe(401);
    expect((await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'wrong-password' },
    })).statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'test-admin', password: 'test-admin-password' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toEqual({ status: 'ok', authenticated: true });
    const setCookie = login.headers['set-cookie'];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0];
    expect(cookie).toMatch(/^telemetry_session=/);
    expect(login.headers['set-cookie']).toContain('HttpOnly');

    const headers = { cookie };
    const session = await app.inject({ method: 'GET', url: '/api/auth/session', headers });
    expect(session.statusCode).toBe(200);

    await post({ ...event, message: 'searchable database failure' });
    const list = await app.inject({ method: 'GET', url: '/api/issues?search=database', headers });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0].recent_timestamps).toHaveLength(1);
    expect(list.json().items[0].latest_level).toBe('error');

    const issueId = list.json().items[0].id as string;
    const details = await app.inject({ method: 'GET', url: `/api/issues/${issueId}`, headers });
    expect(details.json().events).toHaveLength(1);

    const invalidStatus = await app.inject({
      method: 'PATCH',
      url: `/api/issues/${issueId}/status`,
      headers,
      payload: { status: 'closed' },
    });
    expect(invalidStatus.statusCode).toBe(400);
    const update = await app.inject({
      method: 'PATCH',
      url: `/api/issues/${issueId}/status`,
      headers,
      payload: { status: 'ignored' },
    });
    expect(update.json()).toEqual({ status: 'updated', id: issueId, newStatus: 'ignored' });

    const stream = await app.inject({ method: 'GET', url: '/api/events?search=database', headers });
    expect(stream.statusCode).toBe(200);
    expect(stream.json().items).toHaveLength(1);
    expect(await app.inject({ method: 'GET', url: '/api/services', headers }).then((r) => r.json())).toEqual(['svc']);

    await post({ ...event, message: 'tagged unrelated notice', level: 'info', tags: { build_type: 'debug' } });
    const byLevel = await app.inject({ method: 'GET', url: '/api/events?level=info', headers });
    expect(byLevel.json().items).toHaveLength(1);
    const byTag = await app.inject({ method: 'GET', url: '/api/events?tag=build_type%3Ddebug', headers });
    expect(byTag.json().items).toHaveLength(1);
    expect(byTag.json().items[0].message).toBe('tagged unrelated notice');
    const noTag = await app.inject({ method: 'GET', url: '/api/events?tag=build_type%3Drelease', headers });
    expect(noTag.json().items).toHaveLength(0);
    const issuesByTag = await app.inject({ method: 'GET', url: '/api/issues?status=all&level=info&tag=build_type%3Ddebug', headers });
    expect(issuesByTag.json().items).toHaveLength(1);
    const issuesNoMatch = await app.inject({ method: 'GET', url: '/api/issues?status=all&level=warn', headers });
    expect(issuesNoMatch.json().items).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/api/events?level=bogus', headers })).statusCode).toBe(400);

    const toDelete = byLevel.json().items[0] as { id: string };
    const badBulk = await app.inject({ method: 'POST', url: '/api/events/bulk-delete', headers, payload: { ids: [] } });
    expect(badBulk.statusCode).toBe(400);
    const bulk = await app.inject({ method: 'POST', url: '/api/events/bulk-delete', headers, payload: { ids: [toDelete.id, 'missing'] } });
    expect(bulk.json()).toEqual({ status: 'deleted', deleted: 1 });
    expect((await app.inject({ method: 'GET', url: '/api/events?level=info', headers })).json().items).toHaveLength(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM issues WHERE title LIKE 'tagged%'").get()).toEqual({ count: 0 });

    const deleted = await app.inject({ method: 'DELETE', url: `/api/issues/${issueId}`, headers });
    expect(deleted.json()).toEqual({ status: 'deleted', id: issueId });
    expect(db.prepare('SELECT COUNT(*) AS count FROM events').get()).toEqual({ count: 0 });

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers });
    expect(logout.json()).toEqual({ status: 'ok' });
    expect((await app.inject({ method: 'GET', url: '/api/issues', headers })).statusCode).toBe(401);
  });
});
