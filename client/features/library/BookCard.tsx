import { ArrowUpRight, Highlighter, ImagePlus, MoreHorizontal, Trash2, Upload } from 'lucide-react';
import type { Book } from '../../../shared/types';
import { BookCover } from '../../components/BookCover';
import { plural } from '../../lib/format';
import { usePopupMenu } from '../../hooks/usePopupMenu';

export function BookCard({ book, onOpen, onCover, onImport, onDelete }: {
  book: Book; onOpen: (book: Book) => void; onCover: (book: Book) => void; onImport: (book: Book) => void;
  onDelete: (book: Book) => void;
}) {
  const menu = usePopupMenu();
  return (
    <article className="book-card">
      <button type="button" className="cover-button" onClick={() => onOpen(book)} aria-label={'Abrir ' + book.title + (book.author ? ' — ' + book.author : '')} title={book.title + (book.author ? ' — ' + book.author : '')}>
        <BookCover book={book} />
        <span className="cover-open"><ArrowUpRight size={17} /><span>Abrir</span></span>
      </button>
      <div className="book-card-bottom">
        <p className="book-card-author" title={book.author || 'Autor desconocido'}>{book.author || 'Autor desconocido'}</p>
        <span className="book-annotation-count"><Highlighter size={12} strokeWidth={1.7} /><span>{plural(book.highlightCount + book.noteCount, 'anotación', 'anotaciones')}</span></span>
        <div className="book-menu-wrap" {...menu.rootProps}>
          <button type="button" ref={menu.triggerRef} className={'icon-button book-menu-trigger' + (menu.open ? ' active' : '')} aria-label={'Opciones de ' + book.title} aria-haspopup="menu" aria-expanded={menu.open} aria-controls={menu.open ? menu.menuId : undefined} onClick={menu.toggle}><MoreHorizontal size={19} /></button>
          {menu.open && <div className="book-menu" ref={menu.menuRef} id={menu.menuId} role="menu" aria-label={'Opciones de ' + book.title}>
            <button type="button" role="menuitem" tabIndex={-1} onClick={() => { menu.close(); onCover(book); }}><ImagePlus size={16} />{book.coverUrl ? 'Cambiar portada' : 'Agregar portada'}</button>
            <button type="button" role="menuitem" tabIndex={-1} onClick={() => { menu.close(); onImport(book); }}><Upload size={16} />Importar más anotaciones</button>
            <button type="button" role="menuitem" tabIndex={-1} className="book-menu-delete" onClick={() => { menu.close(); onDelete(book); }}><Trash2 size={16} />Eliminar</button>
          </div>}
        </div>
      </div>
    </article>
  );
}
