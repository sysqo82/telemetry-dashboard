import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateFingerprint } from '../src/services/fingerprint.js';
import { openDb, type Db } from '../src/db/index.js';
import { buildApp } from '../src/app.js';
import { hashKey } from '../src/routes/events.js';

const KEY = 'test-key-1234567890';

describe('fingerprint', () => {
  const base = { service: 'svc', exceptionType: 'Err', message: 'x' };
  it('ignores line numbers and message text when a frame exists', () => {
    const a = generateFingerprint({ ...base, stacktrace: 'at run (/app/db.ts:45)' });
    const b = generateFingerprint({ ...base, message: 'y', stacktrace: 'at run (/app/db.ts:99:3)' });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.culprit).toBe('run (/app/db.ts:45)');
  });
  it('differs by service, type and frame', () => {
    const f = (o: object) => generateFingerprint({ ...base, stacktrace: 'at a (/app/a.ts:1)', ...o }).fingerprint;
    expect(f({})).not.toBe(f({ service: 'other' }));
    expect(f({})).not.toBe(f({ exceptionType: 'Other' }));
    expect(f({})).not.toBe(f({ stacktrace: 'at b (/app/b.ts:1)' }));
  });
  it('skips node_modules frames and normalizes message when no stack', () => {
    const r = generateFingerprint({ ...base, stacktrace: 'at x (/node_modules/y.js:1)\nat mine (/app/m.ts:2)' });
    expect(r.culprit).toContain('mine');
    const a = generateFingerprint({ ...base, message: 'user 123 failed' });
    const b = generateFingerprint({ ...base, message: 'user 456 failed' });
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});

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
  it('healthz works without auth', async () => {
    const r = await app.inject({ method: 'GET', url: '/healthz' });
    expect(r.statusCode).toBe(200);
    expect(r.json().database).toBe('ok');
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
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].recent_timestamps).toHaveLength(1);
    expect(list.json()[0].latest_level).toBe('error');

    const issueId = list.json()[0].id as string;
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
    expect(stream.json()).toHaveLength(1);
    expect(await app.inject({ method: 'GET', url: '/api/services', headers }).then((r) => r.json())).toEqual(['svc']);

    const deleted = await app.inject({ method: 'DELETE', url: `/api/issues/${issueId}`, headers });
    expect(deleted.json()).toEqual({ status: 'deleted', id: issueId });
    expect(db.prepare('SELECT COUNT(*) AS count FROM events').get()).toEqual({ count: 0 });

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers });
    expect(logout.json()).toEqual({ status: 'ok' });
    expect((await app.inject({ method: 'GET', url: '/api/issues', headers })).statusCode).toBe(401);
  });
});
