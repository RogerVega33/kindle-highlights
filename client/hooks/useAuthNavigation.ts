import { useCallback, useEffect, useRef, useState } from 'react';
import { authScreenFromPath, createAuthNavigation } from '../lib/auth-navigation';
import type { AuthNavigationMode, AuthScreen } from '../lib/auth-navigation';

export function useAuthNavigation(mode: AuthNavigationMode, onScreenChange: () => void) {
  const [screen, setScreen] = useState<AuthScreen | null>(() => typeof window === 'undefined' ? null : authScreenFromPath(window.location.pathname));
  const [ready, setReady] = useState(false);
  const navigation = useRef<ReturnType<typeof createAuthNavigation> | null>(null);
  const screenChanged = useRef(onScreenChange);
  screenChanged.current = onScreenChange;

  useEffect(() => {
    const controller = createAuthNavigation(window, (next, userNavigation) => {
      setScreen(next);
      if (userNavigation) screenChanged.current();
    });
    navigation.current = controller;
    setReady(true);
    return () => { controller.dispose(); navigation.current = null; };
  }, []);

  useEffect(() => { navigation.current?.setMode(mode); }, [mode]);
  const navigate = useCallback((next: AuthScreen) => navigation.current?.navigate(next), []);
  return { screen: screen ?? 'login', libraryReady: ready && screen === null, navigate };
}
