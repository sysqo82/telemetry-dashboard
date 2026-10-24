import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';

export function healthRoutes(app: FastifyInstance, db: Db) {
  app.get('/healthz', async (_req, reply) => {
    try {
      db.prepare('SELECT 1').get();
    } catch {
      return reply.status(503).send({ status: 'error', database: 'down' });
    }
    return { status: 'ok', uptime: process.uptime(), memory: process.memoryUsage().rss, database: 'ok' };
  });
}
