import type { EventRecord } from './types.js';

function jsonEvent(event: EventRecord) {
  function parseField(field: 'tags' | 'metadata') {
    const value = event[field];
    if (value === null) return null;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new Error(`Event ${event.id} has invalid JSON in ${field}.`);
    }
  }

  return { ...event, tags: parseField('tags'), metadata: parseField('metadata') };
}

export function eventJson(events: EventRecord | EventRecord[]) {
  return JSON.stringify(Array.isArray(events) ? events.map(jsonEvent) : jsonEvent(events), null, 2);
}

export function downloadJson(json: string, filename: string) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
