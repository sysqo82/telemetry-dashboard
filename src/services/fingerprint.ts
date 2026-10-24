import crypto from 'node:crypto';

export interface FingerprintInput {
  service: string;
  exceptionType?: string;
  message: string;
  stacktrace?: string;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HEX = /0x[0-9a-f]+/gi;

const normalize = (s: string) =>
  s
    .replace(UUID, '<UUID>')
    .replace(HEX, '<HEX>')
    .replace(/:\d+(:\d+)?/g, ':<N>')
    .replace(/\b\d+\b/g, '<N>')
    .trim();

function topAppFrame(stacktrace?: string): string | undefined {
  if (!stacktrace) return undefined;
  return stacktrace
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^at\s/.test(l) && !l.includes('node_modules') && !l.includes('node:internal') && !l.includes('internal/'));
}

export function generateFingerprint(input: FingerprintInput): { fingerprint: string; culprit: string } {
  const frame = topAppFrame(input.stacktrace);
  // culprit keeps the real line number for display; the fingerprint uses the normalized form
  const culprit = frame ? frame.replace(/^at\s+/, '').trim() : 'unknown';
  const type = input.exceptionType || 'Error';
  const discriminator = normalize(frame ?? input.message);
  const raw = `${input.service.toLowerCase()}::${type}::${discriminator}`;
  return { fingerprint: crypto.createHash('sha256').update(raw).digest('hex'), culprit };
}
