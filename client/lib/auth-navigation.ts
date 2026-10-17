import { bookIdFromPath } from './book-navigation';

export type AuthScreen = 'login' | 'register' | 'recover';
export type AuthNavigationMode = 'pending' | 'guest' | 'authenticated';

interface NavigationBrowser {
  location: Pick<Location, 'pathname'>;
  history: Pick<History, 'state' | 'replaceState' | 'pushState'>;
  addEventListener: (type: 'popstate', listener: () => void) => void;
  removeEventListener: (type: 'popstate', listener: () => void) => void;
}

export function authScreenFromPath(pathname: string): AuthScreen | null {
  const match = /^\/(login|register|recover)\/?$/.exec(pathname);
  return match ? match[1] as AuthScreen : null;
}

function destination(path: unknown): string {
  return typeof path === 'string' && !/[?#]/.test(path) && bookIdFromPath(path) ? path : '/';
}

/** Store only routes in history; form values and recovery words never belong here. */
export function createAuthNavigation(browser: NavigationBrowser, onNavigate: (screen: AuthScreen | null, userNavigation: boolean) => void) {
  let mode: AuthNavigationMode = 'pending';
  let activeScreen: AuthScreen | null | undefined;
  const entry = () => browser.history.state?.kindleAuthNavigation;
  const stateFor = (screen: AuthScreen | null, returnTo: string, fromLogin = false) => ({
    ...browser.history.state,
    kindleBookNavigation: undefined,
    kindleAuthNavigation: { screen, returnTo, fromLogin },
  });

  function sync(userNavigation = false) {
    let screen = authScreenFromPath(browser.location.pathname);
    if (mode === 'guest') {
      const returnTo = screen ? destination(entry()?.returnTo) : destination(browser.location.pathname);
      if (!screen) {
        browser.history.replaceState(stateFor('login', returnTo), '', '/login');
        screen = 'login';
      } else if (screen !== 'login' && !(entry()?.screen === screen && entry()?.fromLogin === true)) {
        // A direct link also needs an in-app predecessor for the mobile Back button.
        browser.history.replaceState(stateFor('login', returnTo), '', '/login');
        browser.history.pushState(stateFor(screen, returnTo, true), '', '/' + screen);
      } else if (entry()?.screen !== screen) {
        browser.history.replaceState(stateFor(screen, returnTo), '', '/' + screen);
      }
    } else if (mode === 'authenticated' && screen) {
      const returnTo = destination(entry()?.returnTo);
      browser.history.replaceState(stateFor(null, returnTo), '', returnTo);
      screen = null;
    }
    if (screen === activeScreen) return;
    activeScreen = screen;
    onNavigate(screen, userNavigation);
  }

  const onPopState = () => sync(true);
  browser.addEventListener('popstate', onPopState);
  return {
    setMode(next: AuthNavigationMode) { mode = next; sync(); },
    navigate(screen: AuthScreen) {
      if (mode !== 'guest' || screen === authScreenFromPath(browser.location.pathname)) return;
      const returnTo = destination(entry()?.returnTo);
      browser.history.pushState(stateFor(screen, returnTo, screen !== 'login'), '', '/' + screen);
      sync(true);
    },
    dispose() { browser.removeEventListener('popstate', onPopState); },
  };
}
