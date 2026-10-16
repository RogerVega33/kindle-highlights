import type { Annotation } from '../shared/types';
import { orderAnnotations } from '../shared/annotation-order';

export interface AnnotationSection {
  id: string;
  title: string | null;
  annotations: Annotation[];
}

export function groupAnnotations(annotations: readonly Annotation[]): AnnotationSection[] {
  const sections = new Map<string | null, AnnotationSection>();
  for (const annotation of annotations) {
    const title = annotation.sectionTitle || null;
    let section = sections.get(title);
    if (!section) {
      section = {
        id: title === null ? 'unsectioned' : 'section-' + encodeURIComponent(title),
        title,
        annotations: [],
      };
      sections.set(title, section);
    }
    section.annotations.push(annotation);
  }

  for (const section of sections.values()) {
    section.annotations = orderAnnotations(section.annotations);
  }
  return [...sections.values()];
}
