import { useCallback, useEffect, useState } from 'react';

const THEME_KEY = 'margen-theme';

export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; }
    catch { return 'light'; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const background = getComputedStyle(document.documentElement).getPropertyValue('--page').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background);
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
    try { localStorage.setItem(THEME_KEY, theme); }
    catch { /* A theme preference is optional. */ }
  }, [theme]);
  return { theme, toggleTheme: () => setTheme(previous => previous === 'light' ? 'dark' : 'light') };
}

export function useToast() {
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const notify = useCallback((message: string, error = false) => setToast({ message: message.trimEnd().replace(/\.+$/u, ''), error }), []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.error ? 8000 : 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  return { toast, notify, dismissToast: () => setToast(null) };
}
