import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { ErrorNotice } from '../../components/ErrorNotice';
import { SiteFooter } from '../../components/SiteFooter';
import { SiteHeader, type SiteHeaderProps } from '../../components/SiteHeader';
import { bookIdFromPath, createBookNavigation } from '../../lib/book-navigation';
import { PwaUpdateNotice } from '../../pwa/PwaProvider';

/** Keep navigation available without requesting private data until the session is verified. */
export function SessionUnavailableView({ theme, onToggleTheme, message, checking, onRetry }: {
  theme: SiteHeaderProps['theme'];
  onToggleTheme: () => void;
  message: string;
  checking: boolean;
  onRetry: () => void;
}) {
  const [bookId, setBookId] = useState(() => typeof window === 'undefined' ? null : bookIdFromPath(window.location.pathname));
  const navigation = useRef<ReturnType<typeof createBookNavigation> | null>(null);

  useEffect(() => {
    const controller = createBookNavigation(window, setBookId);
    navigation.current = controller;
    return () => { controller.dispose(); navigation.current = null; };
  }, []);

  function backToLibrary() {
    navigation.current?.backToLibrary();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  return <div className="app">
    <SiteHeader theme={theme} onToggleTheme={onToggleTheme} onHome={backToLibrary} />
    <PwaUpdateNotice />
    <main id="main-content" tabIndex={-1} className={'page-shell ' + (bookId ? 'detail-page' : 'library-page')}>
      {bookId
        ? <button type="button" className="back-button" onClick={backToLibrary}><ArrowLeft size={17} /> Biblioteca</button>
        : <div className="library-intro"><div className="library-heading"><h1>Biblioteca</h1></div></div>}
      <ErrorNotice title={bookId ? 'No pudimos abrir el libro.' : 'No pudimos cargar tu biblioteca.'}
        message={message || 'No pudimos comprobar tu sesión. Inténtalo de nuevo en unos momentos.'}
        action={{ label: checking ? 'Comprobando sesión…' : 'Reintentar', onClick: onRetry, disabled: checking }} />
    </main>
    <SiteFooter />
  </div>;
}
