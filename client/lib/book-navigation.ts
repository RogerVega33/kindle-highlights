interface NavigationBrowser {
  location: Pick<Location, 'pathname' | 'search' | 'hash'>;
  history: Pick<History, 'state' | 'replaceState' | 'pushState' | 'back'>;
  addEventListener: (type: 'popstate', listener: () => void) => void;
  removeEventListener: (type: 'popstate', listener: () => void) => void;
}

export function bookIdFromPath(pathname: string): string | null {
  const match = /^\/books\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try { return decodeURIComponent(match[1]) || null; }
  catch { return null; }
}

/** Keep book URLs and browser history in sync without reloading the application. */
export function createBookNavigation(browser: NavigationBrowser, onNavigate: (bookId: string | null) => void) {
  let activeBookId: string | null | undefined;
  let returningToLibrary = false;
  const currentBookId = () => bookIdFromPath(browser.location.pathname);
  const hasLibraryEntry = () => {
    const entry = browser.history.state?.kindleBookNavigation;
    return entry?.bookId === currentBookId() && entry?.fromLibrary === true;
  };
  const stateFor = (bookId: string | null, fromLibrary = false) => ({
    ...browser.history.state,
    kindleBookNavigation: { bookId, fromLibrary },
  });
  const notify = () => {
    returningToLibrary = false;
    const id = currentBookId();
    if (id === activeBookId) return;
    activeBookId = id;
    onNavigate(id);
  };
  const initialBookId = currentBookId();

  // A link opened in a new tab also needs a library entry for the Back button.
  if (initialBookId && !hasLibraryEntry()) {
    const url = browser.location.pathname + browser.location.search + browser.location.hash;
    browser.history.replaceState(stateFor(null), '', '/');
    browser.history.pushState(stateFor(initialBookId, true), '', url);
  }
  browser.addEventListener('popstate', notify);
  notify();

  return {
    openBook(id: string) {
      if (id === currentBookId()) return;
      const url = '/books/' + encodeURIComponent(id);
      if (currentBookId()) browser.history.replaceState(stateFor(id, hasLibraryEntry()), '', url);
      else browser.history.pushState(stateFor(id, true), '', url);
      notify();
    },
    backToLibrary() {
      if (!currentBookId() || returningToLibrary) return;
      if (hasLibraryEntry()) {
        returningToLibrary = true;
        browser.history.back();
      }
      else {
        browser.history.replaceState(stateFor(null), '', '/');
        notify();
      }
    },
    replaceWithLibrary() {
      browser.history.replaceState(stateFor(null), '', '/');
      notify();
    },
    dispose() { browser.removeEventListener('popstate', notify); },
  };
}
