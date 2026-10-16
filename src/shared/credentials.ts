import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function createKey(): string {
  let suffix = '';
  while (suffix.length < 32) {
    for (const byte of randomBytes(32)) {
      suffix += BASE62[byte % BASE62.length];
      if (suffix.length === 32) break;
    }
  }
  return `mk_live_${suffix}`;
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function fingerprintForKey(key: string): string {
  return `sha256:${hashKey(key).slice(0, 12)}`;
}

export function isValidKey(key: string): boolean {
  return /^mk_live_[0-9A-Za-z]{32}$/.test(key);
}

export function matchesHash(key: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashKey(key), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function isFingerprint(value: string): boolean {
  return /^sha256:[0-9a-f]{12}$/.test(value);
}
