import { MAX_COVER_BYTES } from '../shared/limits.js';
import { RepositoryError } from './errors.js';
import type { Cover } from './repositories/library-repository.js';

export function decodeCover(dataUrl: string): Cover {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (!match || !match[2] || match[2].length % 4 !== 0) throw new RepositoryError('La portada debe ser una imagen PNG, JPEG o WebP en base64.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_COVER_BYTES) throw new RepositoryError(`La portada debe pesar como máximo ${MAX_COVER_BYTES / 1024 / 1024} MB.`);
  if (bytes.toString('base64') !== match[2]) throw new RepositoryError('La imagen en base64 no es válida.');
  // File extensions can give the browser an incorrect MIME type. Store the type identified by the bytes.
  const validPng = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR';
  const validJpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  const validWebp = bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16));
  if (!validPng && !validJpeg && !validWebp) throw new RepositoryError('El contenido de la portada no coincide con una imagen PNG, JPEG o WebP.');
  return { bytes, mime: validPng ? 'image/png' : validJpeg ? 'image/jpeg' : 'image/webp' };
}
