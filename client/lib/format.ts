import type { Annotation } from '../../shared/types';

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocurrió un problema. Inténtalo de nuevo.';
}

export function plural(count: number, singular: string, multiple: string): string {
  return count.toLocaleString('es') + ' ' + (count === 1 ? singular : multiple);
}

export function searchable(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es');
}

export function positionLabel(annotation: Annotation): string {
  return [
    annotation.page !== null ? 'Página ' + annotation.page : '',
    annotation.location !== null ? 'Posición ' + annotation.location : '',
  ].filter(Boolean).join(' · ');
}
