interface NavigationBrowser {
  location: Pick<Location, 'pathname' | 'search' | 'hash'>;
  history: Pick<History, 'state' | 'pushState' | 'back'>;
  addEventListener: (type: 'popstate', listener: () => void) => void;
  removeEventListener: (type: 'popstate', listener: () => void) => void;
}

/** Give the dialog its own history entry so mobile Back dismisses it first. */
export function createRandomAnnotationNavigation(browser: NavigationBrowser, onChange: (open: boolean) => void) {
  const currentUrl = () => browser.location.pathname + browser.location.search + browser.location.hash;
  const isOpen = () => browser.history.state?.kindleRandomAnnotation === currentUrl();
  let closing = false;
  let afterClose: (() => void) | undefined;
  const sync = () => {
    const open = isOpen();
    onChange(open);
    if (!open && closing) {
      closing = false;
      const complete = afterClose;
      afterClose = undefined;
      complete?.();
    }
  };
  browser.addEventListener('popstate', sync);
  sync();

  return {
    open() {
      if (closing || isOpen()) return;
      browser.history.pushState({ ...browser.history.state, kindleRandomAnnotation: currentUrl() }, '');
      sync();
    },
    close(complete?: () => void) {
      if (closing) return;
      if (!isOpen()) { complete?.(); return; }
      closing = true;
      afterClose = complete;
      // Wait for popstate before opening a book: back() traverses asynchronously.
      browser.history.back();
    },
    dispose() {
      afterClose = undefined;
      browser.removeEventListener('popstate', sync);
    },
  };
}
