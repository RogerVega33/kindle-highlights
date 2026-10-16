import { basename } from 'node:path';

export function validFilename(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && value === basename(value) && !/[\\/\u0000]/.test(value) && !value.startsWith('.');
}

