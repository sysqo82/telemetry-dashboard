import { describe, expect, it } from 'vitest';
import { applyTimeRange } from '../frontend/src/timeRange.js';

const NOW = Date.parse('2026-01-01T12:00:00.000Z');
const build = (range: Parameters<typeof applyTimeRange>[1]) => {
  const params = new URLSearchParams();
  applyTimeRange(params, range, NOW);
  return Object.fromEntries(params);
};

describe('time range params', () => {
  it('adds nothing for all time', () => {
    expect(build({ preset: 'all', from: '', to: '' })).toEqual({});
  });

  it.each([
    ['5m', '2026-01-01T11:55:00.000Z'],
    ['15m', '2026-01-01T11:45:00.000Z'],
    ['30m', '2026-01-01T11:30:00.000Z'],
    ['1h', '2026-01-01T11:00:00.000Z'],
    ['24h', '2025-12-31T12:00:00.000Z'],
  ] as const)('maps the %s preset to a from timestamp', (preset, from) => {
    expect(build({ preset, from: '', to: '' })).toEqual({ from });
  });

  it('converts custom local dates to ISO and ignores empty or invalid ones', () => {
    const result = build({ preset: 'custom', from: '2026-01-01T10:00', to: '' });
    expect(result.from).toBe(new Date('2026-01-01T10:00').toISOString());
    expect(result.to).toBeUndefined();
    expect(build({ preset: 'custom', from: 'garbage', to: '2026-01-02T00:00' }).from).toBeUndefined();
  });
});
