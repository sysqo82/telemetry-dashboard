import crypto from 'node:crypto';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';

const COOKIE_NAME = 'telemetry_session';
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function authRoutes(app: FastifyInstance, config: Config): preHandlerHookHandler {
  const sessions = new Map<string, number>();
  const sha = (value: string) => crypto.createHash('sha256').update(value).digest();
  const expectedUsername = sha(config.ADMIN_USERNAME);
  const expectedPassword = sha(config.ADMIN_PASSWORD);

  const authenticate: preHandlerHookHandler = async (request, reply) => {
    const sessionId = request.cookies[COOKIE_NAME];
    if (!sessionId) {
      return reply.status(401).send({ error: 'Unauthorized: No active session' });
    }

    const expiresAt = sessions.get(sessionId);
    if (expiresAt === undefined || Date.now() > expiresAt) {
      sessions.delete(sessionId);
      return reply.status(401).send({ error: 'Session expired' });
    }
  };

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = z.object({ username: z.string().min(1), password: z.string().min(1) }).safeParse(request.body);
    const usernameOk = crypto.timingSafeEqual(sha(parsed.success ? parsed.data.username : ''), expectedUsername);
    const passwordOk = crypto.timingSafeEqual(sha(parsed.success ? parsed.data.password : ''), expectedPassword);
    if (!parsed.success || !usernameOk || !passwordOk) {
      return reply.status(401).send({ error: 'Invalid admin credentials' });
    }

    const now = Date.now();
    for (const [token, expiresAt] of sessions) {
      if (expiresAt <= now) sessions.delete(token);
    }
    const sessionId = crypto.randomBytes(32).toString('hex');
    sessions.set(sessionId, now + SESSION_DURATION_MS);
    reply.setCookie(COOKIE_NAME, sessionId, {
      path: '/',
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return reply.send({ status: 'ok', authenticated: true });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const sessionId = request.cookies[COOKIE_NAME];
    if (sessionId) sessions.delete(sessionId);
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return reply.send({ status: 'ok' });
  });

  app.get('/api/auth/session', { preHandler: authenticate }, async () => ({
    status: 'ok',
    authenticated: true,
  }));

  return authenticate;
}
