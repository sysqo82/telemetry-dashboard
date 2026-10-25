import crypto from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { generateFingerprint } from './fingerprint.js';

export const eventSchema = z.object({
  service: z.string().min(1),
  environment: z.string().default('production'),
  level: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('error'),
  message: z.string().min(1),
  exception: z
    .object({
      type: z.string().optional(),
      value: z.string().optional(),
      stacktrace: z.string().optional(),
    })
    .optional(),
  tags: z.record(z.string()).optional(),
  metadata: z.record(z.any()).optional(),
  timestamp: z.string().datetime({ offset: true }).optional(),
});

export type EventPayload = z.infer<typeof eventSchema>;

export interface IngestedAlert {
  service: string;
  fingerprint: string;
  title: string;
  culprit: string;
  level: string;
  message: string;
}

export function createIngestor(db: Db, onAlert?: (alert: IngestedAlert) => void) {
  const upsertIssue = db.prepare(`
    INSERT INTO issues (id, service, title, culprit, status, occurrence_count, first_seen_at, last_seen_at)
    VALUES (@id, @service, @title, @culprit, 'unresolved', 1, @now, @now)
    ON CONFLICT(id) DO UPDATE SET
      occurrence_count = occurrence_count + 1,
      last_seen_at = @now,
      status = CASE WHEN status = 'resolved' THEN 'unresolved' ELSE status END
  `);
  const insertEvent = db.prepare(`
    INSERT INTO events (id, issue_id, service, environment, level, message, stacktrace, tags, metadata, created_at)
    VALUES (@id, @issueId, @service, @environment, @level, @message, @stacktrace, @tags, @metadata, @now)
  `);

  const run = db.transaction((
    e: EventPayload,
    fingerprint: string,
    culprit: string,
    title: string,
    now: string,
  ) => {
    upsertIssue.run({
      id: fingerprint,
      service: e.service,
      title,
      culprit,
      now,
    });
    insertEvent.run({
      id: crypto.randomUUID(),
      issueId: fingerprint,
      service: e.service,
      environment: e.environment,
      level: e.level,
      message: e.message,
      stacktrace: e.exception?.stacktrace ?? null,
      tags: e.tags ? JSON.stringify(e.tags) : null,
      metadata: e.metadata ? JSON.stringify(e.metadata) : null,
      now,
    });
  });

  return (e: EventPayload): string => {
    const { fingerprint, culprit } = generateFingerprint({
      service: e.service,
      exceptionType: e.exception?.type,
      message: e.message,
      stacktrace: e.exception?.stacktrace,
    });
    const type = e.exception?.type;
    const title = type
      ? `${type}: ${e.exception?.value ?? e.message}`.slice(0, 200)
      : e.message.slice(0, 200);
    run(e, fingerprint, culprit, title, new Date(e.timestamp ?? Date.now()).toISOString());
    if (onAlert && (e.level === 'error' || e.level === 'fatal')) {
      onAlert({
        service: e.service,
        fingerprint,
        title,
        culprit,
        level: e.level,
        message: e.message,
      });
    }
    return fingerprint;
  };
}
