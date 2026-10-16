import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { RepositoryError } from '../errors.js';

// OWASP's scrypt alternative: N=2^16, r=8, p=2 (64 MiB per operation).
const prefix = 'scrypt$65536$8$2$';
const dummyHash = prefix + '0'.repeat(32) + '$' + '0'.repeat(128);
let running = 0;

function derive(password: string, salt: string): Promise<Buffer> {
  if (running >= 2) return Promise.reject(new RepositoryError('Hay varios accesos en curso. Inténtalo de nuevo en unos segundos.', 429));
  running++;
  return new Promise((resolve, reject) => {
    scrypt(password, Buffer.from(salt, 'hex'), 64, { N: 65536, r: 8, p: 2, maxmem: 128 * 1024 * 1024 }, (error, key) => {
      running--;
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return prefix + salt + '$' + (await derive(password, salt)).toString('hex');
}

export async function verifyPassword(password: string, encoded: string | null): Promise<boolean> {
  const valid = encoded !== null && /^scrypt\$65536\$8\$2\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(encoded);
  const parts = (valid ? encoded : dummyHash).split('$');
  const key = await derive(password, parts[4]);
  const equal = timingSafeEqual(key, Buffer.from(parts[5], 'hex'));
  return valid && equal;
}
