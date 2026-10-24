import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { createIngestor } from './services/ingestion.js';
import { eventRoutes } from './routes/events.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { managementRoutes } from './routes/management.js';
import type { IngestedAlert } from './services/ingestion.js';

export function buildApp(config: Config, db: Db, onAlert?: (alert: IngestedAlert) => void) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' && !process.env.VITEST, bodyLimit: 1024 * 1024 });
  app.register(cookie);
  healthRoutes(app, db);
  eventRoutes(app, db, createIngestor(db, onAlert));
  const authenticate = authRoutes(app, config);
  managementRoutes(app, db, authenticate);

  const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../frontend/dist');
  const frontendReady = fs.existsSync(path.join(frontendRoot, 'index.html'));
  if (frontendReady) {
    app.register(fastifyStatic, { root: frontendRoot, prefix: '/', wildcard: false });
  }
  app.setNotFoundHandler((request, reply) => {
    const pathname = new URL(request.raw.url ?? '/', 'http://localhost').pathname;
    if (frontendReady && !pathname.startsWith('/api') && !pathname.startsWith('/v1')) {
      return reply.sendFile('index.html');
    }
    return reply.status(404).send({ error: 'Not Found' });
  });
  return app;
}
