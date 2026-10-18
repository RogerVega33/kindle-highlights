import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, RefObject } from 'react';
import { Pencil } from 'lucide-react';
import type { Book } from '../../../shared/types';
import { MAX_BOOK_AUTHOR_LENGTH, MAX_BOOK_TITLE_LENGTH } from '../../../shared/limits';
import { libraryApi } from '../../api/library';
import { ErrorNotice } from '../../components/ErrorNotice';
import { messageOf } from '../../lib/format';

export function BookMetadata({ book, headingRef, onUpdated, editing, onEditingChange }: {
  book: Book; headingRef: RefObject<HTMLHeadingElement | null>; onUpdated: (book: Book) => void;
  editing: boolean; onEditingChange: (editing: boolean) => void;
}) {
  const [draft, setDraft] = useState({ title: book.title, author: book.author });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const titleInput = useRef<HTMLTextAreaElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const errorId = useId();

  useEffect(() => {
    if (!editing) return;
    setDraft({ title: book.title, author: book.author });
    setError('');
    titleInput.current?.focus();
  }, [editing, book.title, book.author]);

  function finishEditing() {
    onEditingChange(false);
    setError('');
    window.requestAnimationFrame(() => {
      const target = editButton.current?.getClientRects().length ? editButton.current : headingRef.current;
      target?.focus({ preventScroll: true });
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      event.stopPropagation();
      finishEditing();
      return;
    }
    if (event.key === 'Enter' && (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
      event.preventDefault();
      if (!busy && !event.repeat) event.currentTarget.requestSubmit();
    }
  }

  async function saveMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const metadata = { title: draft.title.trim(), author: draft.author.trim() };
    if (!metadata.title) {
      setError('El título no puede estar vacío.');
      titleInput.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const updated = await libraryApi.updateBook(book.id, metadata);
      onUpdated(updated);
      finishEditing();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sidebar-book-meta">
      <h1 ref={headingRef} tabIndex={-1} className={editing ? 'sr-only' : undefined}>{book.title}</h1>
      {editing ? (
        <form className="book-metadata-form" aria-label="Editar título y autor" aria-busy={busy} onSubmit={event => void saveMetadata(event)} onKeyDown={handleKeyDown}>
          <label>Título<textarea ref={titleInput} rows={3} required maxLength={MAX_BOOK_TITLE_LENGTH} disabled={busy} value={draft.title} aria-describedby={error ? errorId : undefined} onChange={event => { const value = event.target.value; setDraft(previous => ({ ...previous, title: value })); setError(''); }} /></label>
          <label>Autor<input type="text" maxLength={MAX_BOOK_AUTHOR_LENGTH} disabled={busy} value={draft.author} placeholder="Autor desconocido" onChange={event => { const value = event.target.value; setDraft(previous => ({ ...previous, author: value })); setError(''); }} /></label>
          {error && <ErrorNotice compact id={errorId} message={error} />}
          <div className="book-metadata-actions">
            <button type="button" className="button button-quiet" disabled={busy} onClick={finishEditing}>Cancelar</button>
            <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </form>
      ) : <div className="sidebar-meta-heading">
        <p>{book.author || 'Autor desconocido'}</p>
        <button type="button" ref={editButton} className="book-metadata-edit" onClick={() => onEditingChange(true)}><Pencil size={14} /> Editar</button>
      </div>}
    </div>
  );
}
