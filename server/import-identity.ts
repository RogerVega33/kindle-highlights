import { createHash } from 'node:crypto';
import type { ParsedAnnotation } from './parser.js';

function normalizedIdentity(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('es');
}

export function bookIdentityHash(title: string, author: string): string {
  const identity = JSON.stringify([normalizedIdentity(title), normalizedIdentity(author)]);
  return createHash('sha256').update(identity).digest('hex');
}

// Always pass the imported original text, including when deleting an edited entry.
export function annotationFingerprint(bookId: string, annotation: ParsedAnnotation): string {
  const text = (annotation.text || '').normalize('NFC').replace(/\r\n?/g, '\n');
  const normalizedText = annotation.kind === 'note'
    ? text.split('\n').map(line => line.replace(/[\t\f\v ]+/g, ' ').trim()).join('\n').trim()
    : text.replace(/\s+/g, ' ').trim();
  const locatorType = annotation.location !== null ? 'location' : 'page';
  const value = annotation.location ?? annotation.page;
  return createHash('sha256').update(JSON.stringify([bookId, annotation.kind, locatorType, value, normalizedText])).digest('hex');
}
