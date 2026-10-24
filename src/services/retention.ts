import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { Db } from '../db/index.js';

export function runRetention(db: Db, retentionDays: number, now = Date.now()): number {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new RangeError('retentionDays must be a positive integer');
  }

  const cutoff = new Date(now - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare('DELETE FROM events WHERE created_at < ?').run(cutoff);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.pragma('optimize');
  db.exec('VACUUM');
  return result.changes;
}

export function initRetentionScheduler(
  db: Db,
  retentionDays: number,
  logger: Pick<Console, 'info' | 'error'> = console,
): ScheduledTask {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new RangeError('retentionDays must be a positive integer');
  }

  const task = cron.schedule('0 3 * * *', () => {
    logger.info('[Retention] Running event pruning and SQLite maintenance...');
    try {
      const deleted = runRetention(db, retentionDays);
      logger.info(`[Retention] Purged ${deleted} events older than ${retentionDays} days.`);
      logger.info('[Retention] SQLite WAL checkpoint, optimization, and VACUUM completed.');
    } catch (error) {
      logger.error('[Retention] Scheduled maintenance failed:', error);
    }
  }, { timezone: 'UTC' });

  logger.info(`[Retention] Scheduler initialized. Retaining events for ${retentionDays} days; runs daily at 03:00 UTC.`);
  return task;
}
