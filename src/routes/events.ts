import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';
import { eventSchema, type EventPayload } from '../services/ingestion.js';

export const hashKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex');

export function eventRoutes(app: FastifyInstance, db: Db, ingest: (e: EventPayload) => string) {
  const findKey = db.prepare('SELECT id, service FROM api_keys WHERE key_hash = ?');
  const touchKey = db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?');

  app.post('/v1/events', async (request, reply) => {
    const provided = request.headers['x-api-key'];
    const key = typeof provided === 'string' && provided
      ? findKey.get(hashKey(provided)) as { id: string; service: string } | undefined
      : undefined;
    if (!key) {
      return reply.status(401).send({ error: 'Unauthorized: invalid API key' });
    }
    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid payload', details: parsed.error.format() });
    }
    if (parsed.data.service !== key.service) {
      return reply.status(403).send({ error: 'Forbidden: API key is not valid for this service' });
    }
    touchKey.run(new Date().toISOString(), key.id);
    return reply.status(202).send({ status: 'accepted', issueId: ingest(parsed.data) });
  });
}
