import { randomInt } from 'node:crypto';
import { MAX_RECOVERY_PHRASE_LENGTH, RECOVERY_WORD_COUNT } from '../../shared/limits.js';
import words from './wordlists/eff-short.json' with { type: 'json' };

export function generateRecoveryPhrase(): string {
  return Array.from({ length: RECOVERY_WORD_COUNT }, () => words[randomInt(words.length)]).join(' ');
}

export function normalizeRecoveryPhrase(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_RECOVERY_PHRASE_LENGTH) return null;
  const normalized = value.trim().toLowerCase().split(/[\s-]+/u);
  return normalized.length === RECOVERY_WORD_COUNT && normalized.every(word => /^[a-z]+$/.test(word))
    ? normalized.join(' ') : null;
}
