import type { Annotation } from './types.js';

export function orderAnnotations(annotations: readonly Annotation[]): Annotation[] {
  const ordered = [...annotations];
  // Source order breaks ties; stable sort retains insertion order between exports.
  if (ordered.every(annotation => annotation.location !== null)) {
    ordered.sort((a, b) => a.location! - b.location! || a.sourceOrder - b.sourceOrder);
  } else if (ordered.every(annotation => annotation.page !== null)) {
    ordered.sort((a, b) => a.page! - b.page! || a.sourceOrder - b.sourceOrder);
  }
  return ordered;
}
