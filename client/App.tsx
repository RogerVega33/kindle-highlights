import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { ArrowLeft, CheckCircle2, CircleAlert, LoaderCircle, X } from 'lucide-react';
import type { Book, PasswordChangeInput, User } from '../shared/types';
import { MAX_COVER_BYTES } from '../shared/limits';
import { libraryApi } from './api/library';
import { SiteFooter } from './components/SiteFooter';
import { ErrorNotice } from './components/ErrorNotice';
import { BookView } from './features/books/BookView';
import { DeleteBookDialog } from './features/books/DeleteBookDialog';
import { ImportDialog } from './features/imports/ImportDialog';
import { LibraryView } from './features/library/LibraryView';
import { useLibrary } from './hooks/useLibrary';
import { useTheme, useToast } from './hooks/usePreferences';
import { SiteHeader, type SiteHeaderProps } from './components/SiteHeader';
import { AuthView } from './features/auth/AuthView';
import { SessionUnavailableView } from './features/auth/SessionUnavailableView';
import { RecoveryPhraseView } from './features/auth/RecoveryPhraseView';
import { ChangePasswordDialog } from './features/auth/ChangePasswordDialog';
import { useAuth } from './hooks/useAuth';
import { readImage } from './lib/files';
import { messageOf } from './lib/format';
import { PwaUpdateNotice } from './pwa/PwaProvider';

function LibraryWorkspace({ user, onLogout, onPasswordChange, onSessionRetry, busy, theme, onToggleTheme, sessionError }: {
  user: User; onLogout: () => void; busy: boolean; theme: SiteHeaderProps['theme']; onToggleTheme: () => void; sessionError: string;
  onPasswordChange: (input: PasswordChangeInput) => Promise<void>;
  onSessionRetry: () => void;
}) {
  const { toast, notify, dismissToast } = useToast();
  const library = useLibrary(notify);
  const [importDialog, setImportDialog] = useState<{ target: Book | null } | null>(null);
  const [deletingBook, setDeletingBook] = useState<Book | null>(null);
  const [passwordDialog, setPasswordDialog] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);
  const coverTarget = useRef<Book | null>(null);
  const coverInFlight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setImportDialog(null);
    setDeletingBook(null);
    setPasswordDialog(false);
    if (!library.bookId) headingRef.current?.focus({ preventScroll: true });
  }, [library.bookId]);

  function backToLibrary() {
    library.backToLibrary();
    if (!library.bookId) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      headingRef.current?.focus({ preventScroll: true });
    }
  }

  function chooseCover(book: Book) {
    if (coverInFlight.current) return;
    coverTarget.current = book;
    coverInput.current?.click();
  }

  function openDeleteBookDialog(book: Book) {
    setDeletingBook(book);
  }

  function removeBookFromLibrary(id: string) {
    library.removeBook(id);
    if (coverTarget.current?.id === id) coverTarget.current = null;
    setDeletingBook(null);
    window.requestAnimationFrame(() => headingRef.current?.focus());
  }

  async function uploadCover(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const book = coverTarget.current;
    event.target.value = '';
    if (!file || !book || coverInFlight.current) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notify('Elige una imagen PNG, JPEG o WebP para la portada.', true);
      return;
    }
    if (file.size > MAX_COVER_BYTES) {
      notify(`La portada debe pesar ${MAX_COVER_BYTES / 1024 / 1024} MB o menos.`, true);
      return;
    }
    coverInFlight.current = true;
    setCoverBusy(true);
    try {
      library.applyCoverUpdate(await libraryApi.setCover(book.id, await readImage(file)));
      notify('Portada actualizada.');
    } catch (cause) {
      notify(messageOf(cause), true);
    } finally {
      coverInFlight.current = false;
      setCoverBusy(false);
    }
  }

  async function removeCover(book: Book) {
    if (coverInFlight.current) return;
    coverInFlight.current = true;
    setCoverBusy(true);
    try {
      library.applyCoverUpdate(await libraryApi.deleteCover(book.id));
      notify('Se quitó la portada.');
    } catch (cause) {
      notify(messageOf(cause), true);
    } finally {
      coverInFlight.current = false;
      setCoverBusy(false);
    }
  }

  async function copyText(text: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      notify('Texto copiado.');
    } catch {
      notify('No se pudo copiar. Puedes seleccionar el texto y copiarlo manualmente.', true);
    }
  }

  function openImportDialog(target: Book | null) {
    setImportDialog({ target });
  }

  const importBook = (book: Book) => openImportDialog(book);
  const selectedBook = library.selectedBook;

  return (
    <div className="app">
      <a href="#main-content" className="skip-link" onClick={event => {
        event.preventDefault();
        const content = document.getElementById('main-content');
        content?.focus({ preventScroll: true });
        content?.scrollIntoView({ block: 'start' });
      }}>Saltar al contenido</a>
      <SiteHeader theme={theme} onToggleTheme={onToggleTheme} onHome={backToLibrary} user={user} onLogout={onLogout} busy={busy}
        onChangePassword={() => setPasswordDialog(true)} />
      <PwaUpdateNotice />
      {sessionError && <div className="page-shell"><ErrorNotice title="Revisa tu sesión" message={sessionError}
        action={{ label: 'Reintentar sesión', onClick: onSessionRetry, disabled: busy }} /></div>}

      <div id="main-content" tabIndex={-1}>
        {selectedBook ? (
          <BookView key={selectedBook.id} book={selectedBook} loading={library.detailLoading} onBack={backToLibrary} onCover={chooseCover} onRemoveCover={book => void removeCover(book)} onImport={importBook} onCopy={text => void copyText(text)} onUpdate={library.applyAnnotationDelete} onAnnotationEdit={library.applyTextUpdate} onMetadataUpdate={library.applyMetadataUpdate} coverBusy={coverBusy} />
        ) : library.bookId ? (
          <main className="page-shell detail-page">
            <button type="button" className="back-button" onClick={backToLibrary}><ArrowLeft size={17} /> Biblioteca</button>
            {library.bookError ? <ErrorNotice
              title={library.bookError.notFound ? 'Este libro no está disponible' : 'No pudimos abrir el libro.'}
              message={library.bookError.notFound ? 'No encontramos este libro en tu biblioteca. Revisa el enlace o vuelve a tus libros.' : library.bookError.message}
              action={{ label: library.bookError.notFound ? 'Volver a la biblioteca' : 'Reintentar', onClick: library.bookError.notFound ? backToLibrary : library.retryBook }} />
              : <div className="library-loading" role="status"><LoaderCircle size={26} className="spin" strokeWidth={1.5} /><span>Abriendo libro…</span></div>}
          </main>
        ) : (
          <LibraryView books={library.books} page={library.page} pageSize={library.pageSize} totalBooks={library.totalBooks} totalAnnotations={library.totalAnnotations} matchingBooks={library.matchingBooks} totalPages={library.totalPages} loading={library.loading} loadError={library.loadError} headingRef={headingRef} query={library.query} sort={library.sort} onQueryChange={library.changeQuery} onSortChange={library.changeSort} onPageChange={library.changePage} onImport={() => openImportDialog(null)} onImportBook={importBook} onOpen={book => void library.openBook(book)} onCover={chooseCover} onDelete={openDeleteBookDialog} onRetry={() => void library.loadBooks()} />
        )}
      </div>

      <SiteFooter />
      <input type="file" ref={coverInput} hidden accept="image/png,image/jpeg,image/webp" aria-label="Elegir imagen de portada" onChange={event => void uploadCover(event)} />
      {importDialog && <ImportDialog target={importDialog.target} onClose={() => setImportDialog(null)} onImported={library.refreshAfterImport} />}
      {deletingBook && <DeleteBookDialog book={deletingBook} onClose={() => setDeletingBook(null)} onDeleted={removeBookFromLibrary} />}
      {passwordDialog && <ChangePasswordDialog onSave={onPasswordChange} onClose={() => setPasswordDialog(false)}
        onSaved={() => { setPasswordDialog(false); notify('Contraseña actualizada. Las demás sesiones se cerraron.'); }} />}
      {coverBusy && <div className="activity-pill" role="status"><LoaderCircle size={15} className="spin" />Actualizando portada…</div>}
      {toast && <div className={'toast' + (toast.error ? ' toast-error' : '')} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleAlert size={18} /> : <CheckCircle2 size={18} />}<span>{toast.message}</span><button type="button" aria-label="Cerrar aviso" onClick={dismissToast}><X size={15} /></button></div>}
    </div>
  );
}

export default function App() {
  const auth = useAuth();
  const { theme, toggleTheme } = useTheme();
  if (auth.user && !auth.checking && !auth.recovery) return <LibraryWorkspace key={auth.user.id} user={auth.user} onLogout={auth.logout} onPasswordChange={auth.changePassword}
    onSessionRetry={auth.retry} busy={auth.busy} theme={theme} onToggleTheme={toggleTheme} sessionError={auth.error} />;
  if (!auth.user && auth.sessionUnavailable && !auth.recovery) return <SessionUnavailableView theme={theme} onToggleTheme={toggleTheme}
    message={auth.error} checking={auth.checking} onRetry={auth.retry} />;
  return <div className="app">
    <SiteHeader theme={theme} onToggleTheme={toggleTheme} onHome={() => window.scrollTo({ top: 0, behavior: 'instant' })} />
    <PwaUpdateNotice />
    {auth.recovery ? <RecoveryPhraseView username={auth.recovery.username} phrase={auth.recovery.phrase} reason={auth.recovery.reason} onContinue={auth.finishRecovery} />
      : auth.checking ? <main className="auth-page page-shell" role="status"><LoaderCircle size={26} className="spin" /> Comprobando sesión…</main>
        : <AuthView busy={auth.busy} error={auth.error} onSubmit={auth.authenticate} onRecover={auth.recover} onClearError={auth.clearError} />}
  </div>;
}
