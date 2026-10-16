import { Copy, Pencil, Trash2 } from 'lucide-react';
import type { Annotation, AnnotationKind } from '../../../shared/types';
import { positionLabel } from '../../lib/format';

function annotationLabel(kind: AnnotationKind): string {
  return kind === 'highlight' ? 'Subrayado' : 'Nota';
}

export function AnnotationCard({ annotation, onCopy, onDelete, onEdit, onShowOriginal }: {
  annotation: Annotation; onCopy: (text: string) => void; onDelete: (annotation: Annotation) => void;
  onEdit: (annotation: Annotation) => void; onShowOriginal: (annotation: Annotation) => void;
}) {
  return (
    <article className={'annotation-card annotation-' + annotation.kind} data-color={annotation.color || undefined}>
      <div className="annotation-meta"><span className="annotation-kind">{annotationLabel(annotation.kind)}</span><span className="annotation-position">{positionLabel(annotation)}</span>
        {annotation.edited && <button type="button" className="annotation-edited" title="Ver original" aria-label="Ver texto original" onClick={() => onShowOriginal(annotation)}>editado</button>}
        <div className="annotation-actions">
          {annotation.text && <button type="button" className="icon-button annotation-copy" aria-label="Copiar texto" title="Copiar texto" onClick={() => onCopy(annotation.text!)}><Copy size={15} /></button>}
          <button type="button" className="icon-button annotation-edit" aria-label="Editar" title="Editar" onClick={() => onEdit(annotation)}><Pencil size={15} /></button>
          <button type="button" className="icon-button annotation-delete" aria-label="Eliminar" title="Eliminar" onClick={() => onDelete(annotation)}><Trash2 size={15} /></button>
        </div>
      </div>
      {annotation.chapterTitle && <p className="annotation-chapter">{annotation.chapterTitle}</p>}
      {annotation.text ? <p className="annotation-text">{annotation.text}</p> : <p className="annotation-missing">Esta entrada no incluye texto en la exportación.</p>}
    </article>
  );
}
