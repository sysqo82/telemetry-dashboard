import { describe, expect, it } from 'vitest';
import { eventJson } from '../frontend/src/eventJson.js';
import type { EventRecord } from '../frontend/src/types.js';

const event: EventRecord = {
  id: 'event-1',
  issue_id: 'issue-1',
  service: 'service',
  environment: 'production',
  level: 'error',
  message: 'Failure',
  stacktrace: null,
  tags: '{"build":"release"}',
  metadata: '{"nested":{"count":2}}',
  created_at: '2026-01-01T00:00:00.000Z',
};

describe('event JSON', () => {
  it('formats a complete event with decoded payload fields', () => {
    const json = eventJson(event);
    expect(json).toContain('\n  "id"');
    expect(JSON.parse(json)).toEqual({
      ...event,
      tags: { build: 'release' },
      metadata: { nested: { count: 2 } },
    });
  });

  it('formats multiple events as an array and preserves null fields', () => {
    const second = { ...event, id: 'event-2', tags: null, metadata: null };
    expect(JSON.parse(eventJson([event, second]))).toEqual([
      { ...event, tags: { build: 'release' }, metadata: { nested: { count: 2 } } },
      second,
    ]);
  });

  it.each(['tags', 'metadata'] as const)('reports malformed %s instead of exporting it', (field) => {
    expect(() => eventJson({ ...event, [field]: 'invalid' })).toThrow(`Event event-1 has invalid JSON in ${field}.`);
  });
});
