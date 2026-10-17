import { useId, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import type { Annotation, BookDetail } from '../../../shared/types';
import { MAX_ANNOTATION_TEXT_LENGTH } from '../../../shared/limits';
import { libraryApi } from '../../api/library';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import { Modal } from '../../components/Modal';
import { ErrorNotice } from '../../components/ErrorNotice';
import { messageOf, positionLabel } from '../../lib/format';

export function EditAnnotationDialog({ annotation, onClose, onSaved, returnFocusFallbackRef }: {
  annotation: Annotation; onClose: () => void; onSaved: (annotation: Annotation) => void;
  returnFocusFallbackRef: RefObject<HTMLElement | null>;
}) {
  const [text, setText] = useState(annotation.text || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const errorId = useId();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!text.trim()) {
      setError('El texto no puede estar vacío.');
      input.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const updated = await libraryApi.updateAnnotation(annotation.bookId, annotation.id, text);
      onSaved(updated);
    } catch (cause) {
      setError(messageOf(cause));
      setBusy(false);
    }
  }

  return (
    <Modal title={annotation.kind === 'note' ? 'Editar nota' : 'Editar subrayado'} description="Se conservarán el texto original y la última edición." onClose={() => { if (!busy) onClose(); }} className="edit-annotation-modal" initialFocusRef={input} returnFocusFallbackRef={returnFocusFallbackRef}>
      <form className="annotation-edit-form" onSubmit={event => void save(event)} aria-busy={busy}>
        <label>Texto<textarea ref={input} rows={10} required maxLength={MAX_ANNOTATION_TEXT_LENGTH} disabled={busy} value={text} aria-describedby={error ? errorId : undefined} onChange={event => { setText(event.target.value); setError(''); }} /></label>
        {error && <ErrorNotice compact id={errorId} message={error} />}
        <div className="modal-footer">
          <button type="button" className="button button-quiet" disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function OriginalAnnotationDialog({ annotation, onClose, onRestored, returnFocusFallbackRef }: {
  annotation: Annotation; onClose: () => void; onRestored: (annotation: Annotation) => void;
  returnFocusFallbackRef: RefObject<HTMLElement | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  async function restore() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      onRestored(await libraryApi.restoreAnnotation(annotation.bookId, annotation.id));
    } catch (cause) {
      setError(messageOf(cause));
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal title={annotation.kind === 'note' ? 'Nota original' : 'Subrayado original'} description={positionLabel(annotation) || 'Texto importado de Kindle.'} onClose={() => { if (!inFlight.current) onClose(); }} className="original-annotation-modal" returnFocusFallbackRef={returnFocusFallbackRef}>
      <div aria-busy={busy}>
        <p className="original-annotation-text" tabIndex={0}>{annotation.originalText ?? 'Esta entrada no incluye texto en la exportación.'}</p>
        {error && <ErrorNotice compact message={error} />}
        <div className="modal-footer">
          <button type="button" className={'button ' + (annotation.edited ? 'button-quiet' : 'button-primary')} disabled={busy} onClick={onClose}>Cerrar</button>
          {annotation.edited && <button type="button" className="button button-primary" disabled={busy} onClick={() => void restore()}>
            {busy ? 'Restaurando…' : 'Restaurar'}
          </button>}
        </div>
      </div>
    </Modal>
  );
}

export function DeleteAnnotationDialog({ annotation, bookTitle, onClose, onDeleted }: {
  annotation: Annotation; bookTitle: string; onClose: () => void; onDeleted: (book: BookDetail) => void;
}) {
  const dialogTitle = annotation.kind === 'note' ? 'Eliminar nota' : 'Eliminar subrayado';

  return (
    <ConfirmationDialog
      title={dialogTitle}
      description={'¿Quieres eliminar ' + (annotation.kind === 'note' ? 'esta nota' : 'este subrayado') + ' de «' + bookTitle + '»?'}
      onClose={onClose}
      className="delete-annotation-modal"
      onConfirm={async () => {
        onDeleted(await libraryApi.deleteAnnotation(annotation.bookId, annotation.id));
      }}
    >
      {annotation.text && <p className="delete-annotation-preview">{annotation.text}</p>}
    </ConfirmationDialog>
  );
}
