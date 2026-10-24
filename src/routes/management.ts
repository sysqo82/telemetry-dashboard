import crypto from 'node:crypto';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { hashKey } from './events.js';

const listQuerySchema = z.object({
  status: z.enum(['all', 'unresolved', 'resolved', 'ignored']).default('unresolved'),
  service: z.string().max(200).optional(),
  search: z.string().trim().max(200).optional(),
});
const statusBodySchema = z.object({
  status: z.enum(['unresolved', 'resolved', 'ignored']),
});

interface TimestampRow {
  recent_timestamps: string | null;
}

function addTimestampArrays<T extends TimestampRow>(rows: T[]) {
  return rows.map((row) => ({
    ...row,
    recent_timestamps: row.recent_timestamps ? JSON.parse(row.recent_timestamps) as string[] : [],
  }));
}

function toFtsQuery(search: string): string {
  return (search.match(/[\p{L}\p{N}_-]+/gu) ?? [])
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(' AND ');
}

export function managementRoutes(
  app: FastifyInstance,
  db: Db,
  authenticate: preHandlerHookHandler,
) {
  app.get('/api/issues', { preHandler: authenticate }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query parameters' });
    }

    const { status, service, search } = parsed.data;
    const statusFilter = status === 'all' ? null : status;
    const ftsQuery = search ? toFtsQuery(search) : '';
    if (search && !ftsQuery) return [];

    const query = ftsQuery
      ? db.prepare(`
          SELECT i.*,
            (SELECT level FROM events WHERE issue_id = i.id ORDER BY created_at DESC LIMIT 1) AS latest_level,
            (SELECT json_group_array(created_at) FROM (
              SELECT created_at FROM events WHERE issue_id = i.id
              ORDER BY created_at DESC LIMIT 20
            )) AS recent_timestamps
          FROM issues i
          WHERE (@status IS NULL OR i.status = @status)
            AND (@service IS NULL OR i.service = @service)
            AND EXISTS (
              SELECT 1
              FROM events e
              JOIN events_fts ON events_fts.rowid = e.rowid
              WHERE e.issue_id = i.id AND events_fts MATCH @search
            )
          ORDER BY i.last_seen_at DESC
        `).all({ status: statusFilter, service: service || null, search: ftsQuery })
      : db.prepare(`
          SELECT i.*,
            (SELECT level FROM events WHERE issue_id = i.id ORDER BY created_at DESC LIMIT 1) AS latest_level,
            (SELECT json_group_array(created_at) FROM (
              SELECT created_at FROM events WHERE issue_id = i.id
              ORDER BY created_at DESC LIMIT 24
            )) AS recent_timestamps
          FROM issues i
          WHERE (@status IS NULL OR i.status = @status)
            AND (@service IS NULL OR i.service = @service)
          ORDER BY i.last_seen_at DESC
        `).all({ status: statusFilter, service: service || null });

    return addTimestampArrays(query as (TimestampRow & Record<string, unknown>)[]);
  });

  app.get('/api/keys', { preHandler: authenticate }, async () => db.prepare(
    'SELECT id, service, key_prefix, created_at, last_used_at FROM api_keys ORDER BY created_at DESC',
  ).all());

  app.post('/api/keys', { preHandler: authenticate }, async (request, reply) => {
    const parsed = z.object({ service: z.string().trim().min(1).max(100) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'A service name is required' });

    const apiKey = `tm_${crypto.randomBytes(32).toString('hex')}`;
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const keyPrefix = apiKey.slice(0, 11);
    db.prepare(
      'INSERT INTO api_keys (id, service, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, parsed.data.service, hashKey(apiKey), keyPrefix, createdAt);
    return reply.status(201).send({ id, service: parsed.data.service, key_prefix: keyPrefix, created_at: createdAt, apiKey });
  });

  app.delete('/api/keys/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
    if (result.changes === 0) return reply.status(404).send({ error: 'API key not found' });
    return { status: 'revoked', id };
  });

  app.get('/api/services', { preHandler: authenticate }, async () => (
    db.prepare('SELECT DISTINCT service FROM issues ORDER BY service').all() as { service: string }[]
  ).map(({ service }) => service));

  app.get('/api/events', { preHandler: authenticate }, async (request, reply) => {
    const parsed = z.object({ search: z.string().trim().max(200).optional() }).safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query parameters' });
    }

    const search = parsed.data.search ? toFtsQuery(parsed.data.search) : '';
    if (parsed.data.search && !search) return [];
    if (search) {
      return db.prepare(`
        SELECT e.*, i.title AS issue_title, i.status AS issue_status
        FROM events e
        LEFT JOIN issues i ON i.id = e.issue_id
        JOIN events_fts ON events_fts.rowid = e.rowid
        WHERE events_fts MATCH ?
        ORDER BY e.created_at DESC
        LIMIT 100
      `).all(search);
    }

    return db.prepare(`
      SELECT e.*, i.title AS issue_title, i.status AS issue_status
      FROM events e
      LEFT JOIN issues i ON i.id = e.issue_id
      ORDER BY e.created_at DESC
      LIMIT 100
    `).all();
  });

  app.get('/api/issues/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(id);
    if (!issue) return reply.status(404).send({ error: 'Issue not found' });

    const events = db.prepare(`
      SELECT * FROM events WHERE issue_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(id);
    return { issue, events };
  });

  app.patch('/api/issues/:id/status', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = statusBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid issue status' });

    const result = db.prepare('UPDATE issues SET status = ? WHERE id = ?').run(parsed.data.status, id);
    if (result.changes === 0) return reply.status(404).send({ error: 'Issue not found' });
    return { status: 'updated', id, newStatus: parsed.data.status };
  });

  app.delete('/api/issues/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    db.prepare('DELETE FROM issues WHERE id = ?').run(id);
    return { status: 'deleted', id };
  });
}
