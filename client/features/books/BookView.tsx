import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ChevronDown, ChevronsUpDown, Highlighter, ImagePlus, LoaderCircle,
  Plus, Search, StickyNote, Trash2, X,
} from 'lucide-react';
import type { Annotation, AnnotationKind, Book, BookDetail } from '../../../shared/types';
import { groupAnnotations } from '../../annotations';
import { BookCover } from '../../components/BookCover';
import { plural, positionLabel, searchable } from '../../lib/format';
import { AnnotationCard } from '../annotations/AnnotationCard';
import { DeleteAnnotationDialog, EditAnnotationDialog, OriginalAnnotationDialog } from '../annotations/AnnotationDialogs';
import { BookMetadata } from './BookMetadata';
import { BookCoverMenu } from './BookCoverMenu';

export function BookView({ book, loading, onBack, onCover, onRemoveCover, onImport, onCopy, onUpdate, onAnnotationEdit, onMetadataUpdate, coverBusy }: {
  book: BookDetail; loading: boolean; onBack: () => void; onCover: (book: Book) => void;
  onRemoveCover: (book: Book) => void; onImport: (book: Book) => void; onCopy: (text: string) => void;
  onUpdate: (book: BookDetail) => void; onAnnotationEdit: (annotation: Annotation) => void;
  onMetadataUpdate: (book: Book) => void; coverBusy: boolean;
}) {
  const [filter, setFilter] = useState<'all' | AnnotationKind>('all');
  const [query, setQuery] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set());
  const [deletingAnnotation, setDeletingAnnotation] = useState<Annotation | null>(null);
  const [annotationDialog, setAnnotationDialog] = useState<{ kind: 'edit' | 'original'; annotation: Annotation } | null>(null);
  const [coverActionsVisible, setCoverActionsVisible] = useState(false);
  const coverActionsTimer = useRef<number | null>(null);
  const sectionId = useId();
  const activeFilter = filter === 'highlight' || filter === 'note' ? filter : 'all';
  const annotations = useMemo(() => book.annotations.filter(annotation => annotation.kind === 'highlight' || annotation.kind === 'note'), [book.annotations]);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); }, []);
  useEffect(() => {
    setCoverActionsVisible(false);
    return () => {
      if (coverActionsTimer.current !== null) window.clearTimeout(coverActionsTimer.current);
      coverActionsTimer.current = null;
    };
  }, [book.id, book.coverUrl]);
  const visible = useMemo(() => {
    const search = searchable(query.trim());
    return annotations.filter(annotation =>
      (activeFilter === 'all' || annotation.kind === activeFilter) &&
      (!search || searchable([annotation.text, annotation.sectionTitle, annotation.chapterTitle, positionLabel(annotation)].filter(Boolean).join(' ')).includes(search)),
    );
  }, [annotations, activeFilter, query]);
  const sections = useMemo(() => groupAnnotations(annotations), [annotations]);
  const chapterIds = useMemo(() => sections.filter(group => group.title).map(group => group.id), [sections]);
  const allChaptersCollapsed = chapterIds.length > 0 && chapterIds.every(id => collapsedSections.has(id));
  const groups = useMemo(() => {
    const visibleIds = new Set(visible.map(annotation => annotation.id));
    return sections.map(group => ({ ...group, annotations: group.annotations.filter(annotation => visibleIds.has(annotation.id)) }))
      .filter(group => group.annotations.length > 0);
  }, [sections, visible]);

  function toggleAllChapters() {
    setCollapsedSections(previous => chapterIds.every(id => previous.has(id)) ? new Set() : new Set(chapterIds));
  }

  function hideCoverActions() {
    if (coverActionsTimer.current !== null) window.clearTimeout(coverActionsTimer.current);
    coverActionsTimer.current = null;
    setCoverActionsVisible(false);
  }

  function showCoverActions() {
    if (coverBusy) return;
    if (coverActionsTimer.current !== null) window.clearTimeout(coverActionsTimer.current);
    setCoverActionsVisible(true);
    coverActionsTimer.current = window.setTimeout(() => {
      coverActionsTimer.current = null;
      setCoverActionsVisible(false);
    }, 3000);
  }

  function toggleSection(id: string) {
    setCollapsedSections(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const filters: { value: 'all' | AnnotationKind; label: string; count: number }[] = [
    { value: 'all', label: 'Todo', count: annotations.length },
    { value: 'highlight', label: 'Subrayados', count: book.highlightCount },
    { value: 'note', label: 'Notas', count: book.noteCount },
  ];
  return (
    <><main className="page-shell detail-page">
      <button type="button" className="back-button" onClick={onBack}><ArrowLeft size={17} /> Biblioteca</button>
      <div className="detail-layout">
        <aside className="book-sidebar">
          <div className="book-cover-summary">
            <div className={'detail-cover' + (coverActionsVisible ? ' is-active' : '')}>
              <div className="detail-cover-static"><BookCover book={book} detail /></div>
              <button type="button" className="detail-cover-trigger" disabled={coverBusy}
                aria-label={'Mostrar opciones de portada de ' + book.title}
                onClick={showCoverActions}>
                <BookCover book={book} detail />
              </button>
              <button type="button" className="cover-edit-button" disabled={coverBusy}
                onClick={() => { hideCoverActions(); onCover(book); }}>
                <ImagePlus size={15} aria-hidden="true" />{book.coverUrl ? 'Cambiar portada' : 'Agregar portada'}
              </button>
            </div>
          </div>
          <div className="book-details">
            <BookMetadata book={book} headingRef={title} onUpdated={onMetadataUpdate} />
            <div className="book-stats"><span><Highlighter size={15} />{plural(book.highlightCount, 'subrayado', 'subrayados')}</span><span><StickyNote size={15} />{plural(book.noteCount, 'nota', 'notas')}</span></div>
          </div>
          <div className="book-actions">
            <button type="button" className="button button-outline sidebar-import" onClick={() => onImport(book)}><Plus size={16} /> Importar más</button>
            <BookCoverMenu key={book.id} book={book} busy={coverBusy} onCover={item => { hideCoverActions(); onCover(item); }} onRemoveCover={onRemoveCover} />
            {book.coverUrl && <button type="button" className="remove-cover-button" disabled={coverBusy} onClick={() => onRemoveCover(book)}><Trash2 size={12} /> Quitar portada</button>}
          </div>
        </aside>
        <section className="reading-pane" aria-label="Anotaciones del libro">
          <header className="reading-header"><h2>Anotaciones</h2></header>
          <div className="annotation-controls">
            <div className="annotation-toolbar">
              <div className="annotation-tabs" aria-label="Filtrar por tipo">{filters.map(item => <button type="button" key={item.value} className={activeFilter === item.value ? 'active' : ''} aria-pressed={activeFilter === item.value} onClick={() => setFilter(item.value)}>{item.label}<span>{item.count}</span></button>)}</div>
              {chapterIds.length > 0 && <button type="button" className="chapters-toggle" aria-label={allChaptersCollapsed ? 'Expandir todos los capítulos' : 'Contraer todos los capítulos'} aria-expanded={!allChaptersCollapsed} aria-controls={groups.filter(group => group.title).map(group => sectionId + '-' + group.id).join(' ') || undefined} onClick={toggleAllChapters}>
                <ChevronsUpDown size={15} aria-hidden="true" /><span className="chapters-toggle-label">{allChaptersCollapsed ? 'Expandir todos' : 'Contraer todos'}</span>
              </button>}
            </div>
            <label className="search-field annotation-search"><Search size={17} /><input type="search" placeholder="Buscar entre tus anotaciones…" value={query} onChange={event => setQuery(event.target.value)} aria-label="Buscar en las anotaciones" />{query && <button type="button" className="icon-button" aria-label="Limpiar búsqueda de anotaciones" onClick={() => setQuery('')}><X size={15} /></button>}</label>
          </div>
          {loading && <div className="refreshing" role="status"><LoaderCircle size={14} className="spin" /> Actualizando anotaciones…</div>}
          <div className="annotation-groups">
            {groups.map(group => {
              const collapsed = !!group.title && collapsedSections.has(group.id);
              const contentId = sectionId + '-' + group.id;
              return <section className="annotation-group" key={group.id}>
                {group.title && <h3 className="section-title">
                  <button type="button" className="section-toggle" aria-expanded={!collapsed} aria-controls={contentId} onClick={() => toggleSection(group.id)}>
                    <ChevronDown size={20} className="section-chevron" aria-hidden="true" />
                    <span className="section-label">{group.title}</span>
                    <span className="section-count" aria-label={plural(group.annotations.length, 'anotación', 'anotaciones')}>{group.annotations.length}</span>
                    <span className="section-rule" aria-hidden="true" />
                  </button>
                </h3>}
                <div id={contentId} hidden={collapsed}>
                  {group.annotations.map(annotation => <AnnotationCard key={annotation.id} annotation={annotation} onCopy={onCopy} onDelete={setDeletingAnnotation} onEdit={item => setAnnotationDialog({ kind: 'edit', annotation: item })} onShowOriginal={item => setAnnotationDialog({ kind: 'original', annotation: item })} />)}
                </div>
              </section>;
            })}
            {!visible.length && <div className="no-annotations"><Search size={25} strokeWidth={1.3} /><h3>{query ? 'No se encontraron anotaciones.' : 'No hay anotaciones para mostrar.'}</h3><p>{query ? 'Prueba con otras palabras o cambia el filtro.' : 'Elige otro filtro o importa una nueva exportación de este libro.'}</p>{(query || activeFilter !== 'all') && <button type="button" className="text-button" onClick={() => { setQuery(''); setFilter('all'); }}>Ver todas las anotaciones</button>}</div>}
          </div>
        </section>
      </div>
    </main>
      {deletingAnnotation && <DeleteAnnotationDialog annotation={deletingAnnotation} bookTitle={book.title} onClose={() => setDeletingAnnotation(null)} onDeleted={updated => {
        onUpdate(updated);
        setDeletingAnnotation(null);
        window.requestAnimationFrame(() => title.current?.focus());
      }} />}
      {annotationDialog?.kind === 'edit' && <EditAnnotationDialog annotation={annotationDialog.annotation} onClose={() => setAnnotationDialog(null)} returnFocusFallbackRef={title} onSaved={updated => {
        onAnnotationEdit(updated);
        setAnnotationDialog(null);
      }} />}
      {annotationDialog?.kind === 'original' && <OriginalAnnotationDialog annotation={annotationDialog.annotation} onClose={() => setAnnotationDialog(null)} />}
    </>
  );
}
