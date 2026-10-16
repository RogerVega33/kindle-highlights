import type { RefObject } from 'react';
import { LoaderCircle, Plus, Search, X } from 'lucide-react';
import { ErrorNotice } from '../../components/ErrorNotice';
import type { Book, BookSort } from '../../../shared/types';
import { plural } from '../../lib/format';
import { BookCard } from './BookCard';
import { BookSortMenu } from './BookSortMenu';
import { EmptyLibrary } from './EmptyLibrary';
import { LibraryPagination } from './LibraryPagination';

export interface LibraryViewProps {
  books: readonly Book[];
  page: number;
  pageSize: number;
  totalBooks: number;
  totalAnnotations: number;
  matchingBooks: number;
  totalPages: number;
  loading: boolean;
  loadError: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  query: string;
  sort: BookSort;
  onQueryChange: (value: string) => void;
  onSortChange: (value: BookSort) => void;
  onPageChange: (page: number) => void;
  onImport: () => void;
  onImportBook: (book: Book) => void;
  onOpen: (book: Book) => void;
  onCover: (book: Book) => void;
  onDelete: (book: Book) => void;
  onRetry: () => void;
}

export function LibraryView({
  books, page, pageSize, totalBooks, totalAnnotations, matchingBooks, totalPages,
  loading, loadError, headingRef, query, sort,
  onQueryChange, onSortChange, onPageChange, onImport, onImportBook, onOpen, onCover, onDelete, onRetry,
}: LibraryViewProps) {
  function changePage(nextPage: number) {
    onPageChange(nextPage);
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }

  return (
    <main className="page-shell library-page">
      <div className="library-intro">
        <div className="library-heading">
          <h1 ref={headingRef} tabIndex={-1}>Biblioteca</h1>
          <div className="library-totals">
            <span className="library-count">{query.trim() ? matchingBooks + ' de ' : ''}{plural(totalBooks, 'libro', 'libros')}</span>
            <span className="library-count"><span className="library-count-divider" aria-hidden="true">·</span>{plural(totalAnnotations, 'anotación', 'anotaciones')}</span>
          </div>
        </div>
        <button type="button" className="button button-primary main-import" onClick={onImport}><Plus size={18} /> Importar</button>
      </div>
      <div className="library-toolbar">
        <label className="search-field library-search"><Search size={17} /><input type="search" placeholder="Buscar título o autor…" aria-label="Buscar libros por título o autor" value={query} onChange={event => onQueryChange(event.target.value)} />{query && <button type="button" className="icon-button" aria-label="Limpiar búsqueda" onClick={() => onQueryChange('')}><X size={15} /></button>}</label>
        <BookSortMenu value={sort} onChange={onSortChange} />
      </div>
      {loadError && <ErrorNotice title="No pudimos cargar tu biblioteca." message={loadError} action={{ label: 'Reintentar', onClick: onRetry }} />}
      {loading ? <div className="library-loading" role="status"><LoaderCircle size={26} className="spin" strokeWidth={1.5} /><span>Cargando biblioteca…</span></div> : !loadError ? (
        totalBooks === 0 ? <EmptyLibrary onImport={onImport} /> : matchingBooks === 0 ? <div className="no-books"><Search size={29} strokeWidth={1.2} /><h2>No encontramos ese libro.</h2><p>Prueba con otro título o nombre de autor.</p><button type="button" className="text-button" onClick={() => onQueryChange('')}>Ver toda mi biblioteca</button></div> : <div className="book-grid">{books.map(book => <BookCard key={book.id} book={book} onOpen={onOpen} onCover={onCover} onImport={onImportBook} onDelete={onDelete} />)}</div>
      ) : null}
      {!loadError && matchingBooks > 0 && totalPages > 1 && <LibraryPagination page={page} pageSize={pageSize} matchingBooks={matchingBooks} totalPages={totalPages} loading={loading} onPageChange={changePage} />}
    </main>
  );
}
