import { BookOpen, Plus } from 'lucide-react';

export function EmptyLibrary({ onImport }: { onImport: () => void }) {
  return (
    <div className="empty-library">
      <div className="empty-books" aria-hidden="true">
        <div className="empty-book empty-book-back"><span /><span /><span /></div>
        <div className="empty-book empty-book-front"><BookOpen size={31} strokeWidth={1.1} /><i /><span /><span /><span /><b>Kindle highlights</b></div>
        <span className="empty-books-shadow" />
      </div>
      <span className="eyebrow">IMPORTAR LIBROS</span>
      <h2>Aún no hay libros importados.</h2>
      <p>Importa una exportación HTML de Kindle para añadir sus subrayados y notas.</p>
      <button type="button" className="button button-primary" onClick={onImport}><Plus size={18} /> Importar libro</button>
    </div>
  );
}
