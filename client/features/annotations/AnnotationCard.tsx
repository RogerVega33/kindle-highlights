import { Copy, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { Annotation, AnnotationKind } from '../../../shared/types';
import { usePopupMenu } from '../../hooks/usePopupMenu';
import { positionLabel } from '../../lib/format';

function annotationLabel(kind: AnnotationKind): string {
  return kind === 'highlight' ? 'Subrayado' : 'Nota';
}

export function AnnotationCard({ annotation, onCopy, onDelete, onEdit, onShowOriginal }: {
  annotation: Annotation; onCopy: (text: string) => void; onDelete: (annotation: Annotation) => void;
  onEdit: (annotation: Annotation) => void; onShowOriginal: (annotation: Annotation) => void;
}) {
  const menu = usePopupMenu();
  const position = positionLabel(annotation);
  const menuLabel = 'Opciones de ' + (annotation.kind === 'highlight' ? 'subrayado' : 'nota') + (position ? ': ' + position : '');

  return (
    <article className={'annotation-card annotation-' + annotation.kind} data-color={annotation.color || undefined}>
      <div className="annotation-meta">
        <div className="annotation-info">
          <span className="annotation-kind">{annotationLabel(annotation.kind)}</span><span className="annotation-position">{position}</span>
          {annotation.edited && <button type="button" className="annotation-edited" title="Ver original" aria-label="Ver texto original" onClick={() => onShowOriginal(annotation)}>editado</button>}
        </div>
        <div className="annotation-actions" {...menu.rootProps}>
          <button type="button" className="icon-button annotation-menu-trigger" ref={menu.triggerRef} aria-label={menuLabel}
            aria-haspopup="menu" aria-expanded={menu.open} aria-controls={menu.open ? menu.menuId : undefined} onClick={menu.toggle}>
            <MoreHorizontal size={20} aria-hidden="true" />
          </button>
          {menu.open && <div className="annotation-menu" id={menu.menuId} role="menu" aria-label={menuLabel} ref={menu.menuRef}>
            {annotation.text && <button type="button" role="menuitem" tabIndex={-1} onClick={() => { menu.close(); onCopy(annotation.text!); }}><Copy size={18} aria-hidden="true" />Copiar</button>}
            <button type="button" role="menuitem" tabIndex={-1} onClick={() => { menu.close(); onEdit(annotation); }}><Pencil size={18} aria-hidden="true" />Editar</button>
            <button type="button" className="annotation-menu-delete" role="menuitem" tabIndex={-1} onClick={() => { menu.close(); onDelete(annotation); }}><Trash2 size={18} aria-hidden="true" />Eliminar</button>
          </div>}
        </div>
      </div>
      {annotation.chapterTitle && <p className="annotation-chapter">{annotation.chapterTitle}</p>}
      {annotation.text ? <p className="annotation-text">{annotation.text}</p> : <p className="annotation-missing">Esta entrada no incluye texto en la exportación.</p>}
    </article>
  );
}
