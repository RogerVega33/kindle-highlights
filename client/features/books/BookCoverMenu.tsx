import { ImagePlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { Book } from '../../../shared/types';
import { usePopupMenu } from '../../hooks/usePopupMenu';

export function BookCoverMenu({ book, busy, editingMetadata, onEditMetadata, onCover, onRemoveCover }: {
  book: Book; busy: boolean; onCover: (book: Book) => void; onRemoveCover: (book: Book) => void;
  editingMetadata: boolean; onEditMetadata: () => void;
}) {
  const menu = usePopupMenu();

  return <div className="cover-options-control" {...menu.rootProps}>
    <button type="button" className="button button-outline cover-options-trigger" ref={menu.triggerRef}
      disabled={busy} aria-label={'Opciones del libro ' + book.title} aria-haspopup="menu"
      aria-expanded={menu.open} aria-controls={menu.open ? menu.menuId : undefined} onClick={menu.toggle}>
      <MoreHorizontal size={20} aria-hidden="true" />
    </button>
    {menu.open && <div className="book-menu cover-options-menu" ref={menu.menuRef} id={menu.menuId} role="menu" aria-label="Opciones del libro">
      <button type="button" role="menuitem" tabIndex={-1} disabled={busy || editingMetadata} onClick={() => { menu.close(); onEditMetadata(); }}>
        <Pencil size={18} aria-hidden="true" />Editar
      </button>
      <button type="button" role="menuitem" tabIndex={-1} disabled={busy} onClick={() => { menu.close(); onCover(book); }}>
        <ImagePlus size={18} aria-hidden="true" />{book.coverUrl ? 'Cambiar portada' : 'Agregar portada'}
      </button>
      {book.coverUrl && <button type="button" role="menuitem" tabIndex={-1} disabled={busy} className="book-menu-delete"
        onClick={() => { menu.close(); onRemoveCover(book); }}><Trash2 size={18} aria-hidden="true" />Quitar portada</button>}
    </div>}
  </div>;
}
