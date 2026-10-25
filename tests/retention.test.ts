import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/index.js';
import { createIngestor } from '../src/services/ingestion.js';
import { runRetention } from '../src/services/retention.js';

describe('retention', () => {
  it('deletes only expired events and updates the FTS index', () => {
    const db = openDb(':memory:');
    try {
      const ingest = createIngestor(db);
      const now = Date.parse('2026-10-24T10:00:00.000Z');
      const common = {
        service: 'svc',
        environment: 'production',
        level: 'error' as const,
        message: 'retention marker',
        exception: { type: 'Error' },
      };
      ingest({ ...common, timestamp: '2026-09-20T10:00:00.000Z' });
      ingest({ ...common, timestamp: '2026-10-20T10:00:00.000Z' });

      expect(runRetention(db, 30, now)).toBe(1);
      expect(db.prepare('SELECT COUNT(*) AS count FROM events').get()).toEqual({ count: 1 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM events_fts WHERE events_fts MATCH 'marker'").get()).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });

  it('rejects an invalid retention period', () => {
    const db = openDb(':memory:');
    try {
      expect(() => runRetention(db, 0)).toThrow('retentionDays must be a positive integer');
    } finally {
      db.close();
    }
  });
});
