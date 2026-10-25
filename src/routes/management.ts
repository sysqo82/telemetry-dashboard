import crypto from 'node:crypto';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { hashKey } from './events.js';

// tag filter format: key=value
const TAG_FILTER = /^[^=]+=.+$/;

const levelSchema = z.enum(['debug', 'info', 'warn', 'error', 'fatal']);
const sharedFilters = {
  search: z.string().trim().max(200).optional(),
  level: levelSchema.optional(),
  tag: z.string().trim().regex(TAG_FILTER).max(300).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(15),
};
const validRange = (value: { from?: string; to?: string }) =>
  !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to);

const listQuerySchema = z.object({
  status: z.enum(['all', 'unresolved', 'resolved', 'ignored']).default('unresolved'),
  service: z.string().max(200).optional(),
  ...sharedFilters,
}).refine(validRange);
const eventsQuerySchema = z.object(sharedFilters).refine(validRange);
const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
});
const statusBodySchema = z.object({
  status: z.enum(['unresolved', 'resolved', 'ignored']),
});

interface TimestampRow {
  recent_timestamps: string | null;
}

function normalizeLegacyCulprit<T extends { culprit: string | null }>(issue: T): T {
  return issue.culprit === 'unknown' ? { ...issue, culprit: '' } : issue;
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

function buildEventFilter(ftsQuery: string, level?: string, tag?: string, from?: string, to?: string) {
  const params: Record<string, string> = {};
  const conditions: string[] = [];
  let join = '';
  if (ftsQuery) {
    join = 'JOIN events_fts ON events_fts.rowid = e.rowid';
    conditions.push('events_fts MATCH @search');
    params.search = ftsQuery;
  }
  if (level) {
    conditions.push('e.level = @level');
    params.level = level;
  }
  if (tag) {
    const separator = tag.indexOf('=');
    conditions.push("json_extract(e.tags, '$.' || json_quote(@tagKey)) = @tagValue");
    params.tagKey = tag.slice(0, separator).trim();
    params.tagValue = tag.slice(separator + 1).trim();
  }
  if (from) {
    conditions.push('e.created_at >= @from');
    params.from = new Date(from).toISOString();
  }
  if (to) {
    conditions.push('e.created_at <= @to');
    params.to = new Date(to).toISOString();
  }
  return {
    active: conditions.length > 0,
    join,
    where: conditions.map((condition) => `AND ${condition}`).join(' '),
    params,
  };
}

const emptyPage = (page: number, pageSize: number) => ({ items: [], total: 0, page, pageSize });

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

    const { status, service, search, level, tag, from, to, page, pageSize } = parsed.data;
    const statusFilter = status === 'all' ? null : status;
    const ftsQuery = search ? toFtsQuery(search) : '';
    if (search && !ftsQuery) return emptyPage(page, pageSize);

    // Issue-level time filtering uses last_seen_at; level/tag/search match against events
    const filter = buildEventFilter(ftsQuery, undefined, tag);
    const eventExists = filter.active
      ? `AND EXISTS (SELECT 1 FROM events e ${filter.join} WHERE e.issue_id = i.id ${filter.where})`
      : '';
    const where = `
      WHERE (@status IS NULL OR i.status = @status)
        AND (@service IS NULL OR i.service = @service)
        AND (@level IS NULL OR (SELECT level FROM events WHERE issue_id = i.id ORDER BY created_at DESC LIMIT 1) = @level)
        AND (@from IS NULL OR i.last_seen_at >= @from)
        AND (@to IS NULL OR i.last_seen_at <= @to)
        ${eventExists}
    `;
    const params = {
      status: statusFilter,
      service: service || null,
      level: level ?? null,
      from: from ? new Date(from).toISOString() : null,
      to: to ? new Date(to).toISOString() : null,
      ...filter.params,
    };

    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM issues i ${where}`).get(params) as { total: number };
    const rows = db.prepare(`
      SELECT i.*,
        (SELECT level FROM events WHERE issue_id = i.id ORDER BY created_at DESC LIMIT 1) AS latest_level,
        (SELECT json_group_array(created_at) FROM (
          SELECT created_at FROM events WHERE issue_id = i.id
          ORDER BY created_at DESC LIMIT ${ftsQuery ? 20 : 24}
        )) AS recent_timestamps
      FROM issues i
      ${where}
      ORDER BY i.last_seen_at DESC, i.id
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });

    const items = addTimestampArrays(rows as (TimestampRow & { culprit: string | null } & Record<string, unknown>)[])
      .map(normalizeLegacyCulprit);
    return { items, total, page, pageSize };
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
    const parsed = eventsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query parameters' });
    }

    const { search: rawSearch, level, tag, from, to, page, pageSize } = parsed.data;
    const search = rawSearch ? toFtsQuery(rawSearch) : '';
    if (rawSearch && !search) return emptyPage(page, pageSize);
    const filter = buildEventFilter(search, level, tag, from, to);

    const { total } = db.prepare(`
      SELECT COUNT(*) AS total FROM events e ${filter.join} WHERE 1 = 1 ${filter.where}
    `).get(filter.params) as { total: number };
    const items = db.prepare(`
      SELECT e.*, i.title AS issue_title, i.status AS issue_status
      FROM events e
      LEFT JOIN issues i ON i.id = e.issue_id
      ${filter.join}
      WHERE 1 = 1 ${filter.where}
      ORDER BY e.created_at DESC, e.id
      LIMIT @limit OFFSET @offset
    `).all({ ...filter.params, limit: pageSize, offset: (page - 1) * pageSize });
    return { items, total, page, pageSize };
  });

  app.get('/api/issues/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(id) as
      ({ culprit: string | null } & Record<string, unknown>) | undefined;
    if (!issue) return reply.status(404).send({ error: 'Issue not found' });

    const events = db.prepare(`
      SELECT * FROM events WHERE issue_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(id);
    return { issue: normalizeLegacyCulprit(issue), events };
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

  app.post('/api/issues/bulk-delete', { preHandler: authenticate }, async (request, reply) => {
    const parsed = bulkDeleteSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid ids' });

    const remove = db.prepare('DELETE FROM issues WHERE id = ?');
    const deleted = db.transaction((ids: string[]) => ids.reduce((count, id) => count + remove.run(id).changes, 0))(parsed.data.ids);
    return { status: 'deleted', deleted };
  });

  app.post('/api/events/bulk-delete', { preHandler: authenticate }, async (request, reply) => {
    const parsed = bulkDeleteSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid ids' });

    const findIssue = db.prepare('SELECT issue_id FROM events WHERE id = ?');
    const removeEvent = db.prepare('DELETE FROM events WHERE id = ?');
    const syncIssue = db.prepare(`
      UPDATE issues SET
        occurrence_count = (SELECT COUNT(*) FROM events WHERE issue_id = issues.id),
        last_seen_at = (SELECT MAX(created_at) FROM events WHERE issue_id = issues.id)
      WHERE id = ? AND EXISTS (SELECT 1 FROM events WHERE issue_id = issues.id)
    `);
    const removeEmptyIssue = db.prepare(
      'DELETE FROM issues WHERE id = ? AND NOT EXISTS (SELECT 1 FROM events WHERE issue_id = issues.id)',
    );

    const deleted = db.transaction((ids: string[]) => {
      const affected = new Set<string>();
      let count = 0;
      for (const id of ids) {
        const row = findIssue.get(id) as { issue_id: string } | undefined;
        if (!row) continue;
        count += removeEvent.run(id).changes;
        affected.add(row.issue_id);
      }
      for (const issueId of affected) {
        syncIssue.run(issueId);
        removeEmptyIssue.run(issueId);
      }
      return count;
    })(parsed.data.ids);
    return { status: 'deleted', deleted };
  });
}
