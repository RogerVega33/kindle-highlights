import { MAX_ANNOTATION_TEXT_LENGTH, MAX_BOOK_AUTHOR_LENGTH, MAX_BOOK_TITLE_LENGTH } from '../../shared/limits.js';
import type { UpdateBookInput } from '../../shared/types.js';
import { RepositoryError } from '../errors.js';

export function validateBookMetadata(metadata: UpdateBookInput): UpdateBookInput {
  if (!metadata || typeof metadata.title !== 'string' || typeof metadata.author !== 'string') {
    throw new RepositoryError('El título y el autor deben ser texto.');
  }
  const title = metadata.title.trim();
  const author = metadata.author.trim();
  if (!title) throw new RepositoryError('El título es obligatorio.');
  if (title.length > MAX_BOOK_TITLE_LENGTH) throw new RepositoryError(`El título debe tener como máximo ${MAX_BOOK_TITLE_LENGTH} caracteres.`);
  if (author.length > MAX_BOOK_AUTHOR_LENGTH) throw new RepositoryError(`El autor debe tener como máximo ${MAX_BOOK_AUTHOR_LENGTH} caracteres.`);
  return { title, author };
}

export function validateAnnotationText(text: unknown): string {
  if (typeof text !== 'string') throw new RepositoryError('El contenido de la anotación debe ser texto.');
  if (!text.trim()) throw new RepositoryError('El contenido de la anotación no puede estar vacío.');
  if (text.length > MAX_ANNOTATION_TEXT_LENGTH) throw new RepositoryError(`La anotación debe tener como máximo ${MAX_ANNOTATION_TEXT_LENGTH} caracteres.`);
  return text;
}
