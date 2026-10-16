import { ChevronLeft, ChevronRight } from 'lucide-react';
import { plural } from '../../lib/format';

type PageItem = number | 'earlier' | 'later';

function pageItems(page: number, totalPages: number): PageItem[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, 'later', totalPages];
  if (page >= totalPages - 3) return [1, 'earlier', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, 'earlier', page - 1, page, page + 1, 'later', totalPages];
}

interface LibraryPaginationProps {
  page: number;
  pageSize: number;
  matchingBooks: number;
  totalPages: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}

export function LibraryPagination({ page, pageSize, matchingBooks, totalPages, loading, onPageChange }: LibraryPaginationProps) {
  const firstBook = (page - 1) * pageSize + 1;
  const lastBook = Math.min(page * pageSize, matchingBooks);

  return (
    <div className="library-pagination">
      <p className="library-page-range" role="status" aria-atomic="true">
        {loading ? 'Cargando libros…' : <><span aria-hidden="true">{firstBook}–{lastBook} de {plural(matchingBooks, 'libro', 'libros')}</span><span className="sr-only">Libros {firstBook} a {lastBook} de {matchingBooks}. Página {page} de {totalPages}.</span></>}
      </p>
      {totalPages > 1 && <nav className="pagination-controls" aria-label="Páginas de la biblioteca">
        <button type="button" className="pagination-step" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft size={16} aria-hidden="true" />Anterior</button>
        <ol className="pagination-pages">
          {pageItems(page, totalPages).map(item => <li key={item}>
            {typeof item === 'number' ? <button type="button" className="pagination-page" aria-label={'Página ' + item} aria-current={item === page ? 'page' : undefined} disabled={loading || item === page} onClick={() => onPageChange(item)}>{item}</button> : <span className="pagination-ellipsis" aria-hidden="true">…</span>}
          </li>)}
        </ol>
        <button type="button" className="pagination-step" disabled={loading || page >= totalPages} onClick={() => onPageChange(page + 1)}>Siguiente<ChevronRight size={16} aria-hidden="true" /></button>
      </nav>}
    </div>
  );
}
