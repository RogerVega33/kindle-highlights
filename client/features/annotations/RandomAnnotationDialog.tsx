import { useEffect, useRef, useState } from 'react';
import { BookOpen, LoaderCircle, RefreshCw } from 'lucide-react';
import type { RandomAnnotation } from '../../../shared/types';
import { libraryApi } from '../../api/library';
import { Modal } from '../../components/Modal';
import { ErrorNotice } from '../../components/ErrorNotice';
import { messageOf, positionLabel } from '../../lib/format';

export function RandomAnnotationDialog({ onClose, onOpenBook }: {
  onClose: () => void; onOpenBook: (book: RandomAnnotation['book']) => void;
}) {
  const [selection, setSelection] = useState<RandomAnnotation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);

  async function load(excludeId?: string) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError('');
    try {
      const next = await libraryApi.getRandomAnnotation(excludeId, controller.signal);
      if (!controller.signal.aborted) setSelection(next);
    } catch (cause) {
      if (!controller.signal.aborted) setError(messageOf(cause));
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void load();
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, []);

  return <RandomAnnotationDialogView selection={selection} loading={loading} error={error} onClose={onClose}
    onNew={() => void load(selection?.annotation.id)} onOpenBook={onOpenBook} />;
}

export function RandomAnnotationDialogView({ selection, loading, error, onClose, onNew, onOpenBook }: {
  selection: RandomAnnotation | null; loading: boolean; error: string;
  onClose: () => void; onNew: () => void; onOpenBook: (book: RandomAnnotation['book']) => void;
}) {
  const sourceDetails = selection ? [selection.book.author, positionLabel(selection.annotation)].filter(Boolean).join(' · ') : '';

  return <Modal title="Anotación aleatoria" onClose={onClose} className="random-annotation-modal">
    <div className="random-annotation-content" tabIndex={0} aria-busy={loading} aria-live="polite" aria-atomic="true">
      {selection && <>
        <span className="random-annotation-quote-mark" aria-hidden="true">“</span>
        <blockquote className="random-annotation-quote">{selection.annotation.text}</blockquote>
        <div className="random-annotation-source">
          <div className="random-annotation-book-details">
            <p className="random-annotation-book">{selection.book.title}</p>
            {sourceDetails && <p className="random-annotation-source-details">{sourceDetails}</p>}
            {selection.annotation.chapterTitle && <p className="random-annotation-chapter">{selection.annotation.chapterTitle}</p>}
          </div>
          <span className={'random-annotation-kind' + (selection.annotation.kind === 'note' ? ' random-annotation-kind--note' : '')}>
            {selection.annotation.kind === 'note' ? 'Nota' : 'Subrayado'}
          </span>
        </div>
      </>}
      {loading && <p className="random-annotation-status" role="status"><LoaderCircle size={18} className="spin" aria-hidden="true" />Buscando anotación…</p>}
      {!loading && !error && !selection && <p className="random-annotation-status">Todavía no tienes anotaciones con texto. Importa un libro para comenzar.</p>}
    </div>
    {error && <ErrorNotice compact message={error} />}
    <div className="modal-footer random-annotation-footer">
      <button type="button" className="button button-outline" disabled={!selection || loading} onClick={() => { if (selection) onOpenBook(selection.book); }}><BookOpen size={18} aria-hidden="true" />Abrir libro</button>
      <button type="button" className="button button-primary" disabled={loading} onClick={onNew}><RefreshCw size={17} aria-hidden="true" />Otra anotación</button>
    </div>
  </Modal>;
}
