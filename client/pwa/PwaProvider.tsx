import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { watchPwaUpdates } from './updates';

interface InstallPrompt extends Event {
  prompt: () => Promise<unknown>;
}

const PwaContext = createContext({
  canInstall: false,
  install: async () => {},
  updateAvailable: false,
  applyUpdate: () => {},
  dismissUpdate: () => {},
});

export const usePwa = () => useContext(PwaContext);

export function PwaProvider({ children }: { children: ReactNode }) {
  const [canInstall, setCanInstall] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const installPrompt = useRef<InstallPrompt | null>(null);
  const updates = useRef<ReturnType<typeof watchPwaUpdates> | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD || !window.isSecureContext || !('serviceWorker' in navigator)) return;
    let disposed = false;
    let registration: ServiceWorkerRegistration | null = null;
    let lastCheck = Date.now();

    function beforeInstall(event: Event) {
      if (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone) return;
      event.preventDefault();
      installPrompt.current = event as InstallPrompt;
      setCanInstall(true);
    }
    function installed() { installPrompt.current = null; setCanInstall(false); }
    function checkUpdate() {
      if (document.visibilityState !== 'visible' || !registration || Date.now() - lastCheck < 60_000) return;
      lastCheck = Date.now();
      void registration.update().catch(() => {});
    }

    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', installed);
    document.addEventListener('visibilitychange', checkUpdate);
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(value => {
      if (disposed) return;
      registration = value;
      updates.current = watchPwaUpdates(value, navigator.serviceWorker, () => setUpdateAvailable(true), () => window.location.reload(), {
        version: document.querySelector<HTMLMetaElement>('meta[name="app-version"]')?.content,
        onCurrent: () => setUpdateAvailable(false),
      });
    }).catch(() => {});

    return () => {
      disposed = true;
      updates.current?.dispose();
      updates.current = null;
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', installed);
      document.removeEventListener('visibilitychange', checkUpdate);
    };
  }, []);

  const install = useCallback(async () => {
    const prompt = installPrompt.current;
    if (!prompt) return;
    installPrompt.current = null;
    setCanInstall(false);
    try { await prompt.prompt(); }
    catch { /* Installation is optional and never produces an error notification. */ }
  }, []);

  const applyUpdate = useCallback(() => {
    if (updates.current?.apply()) setUpdateAvailable(false);
  }, []);
  const dismissUpdate = useCallback(() => setUpdateAvailable(false), []);

  return <PwaContext.Provider value={{ canInstall, install, updateAvailable, applyUpdate, dismissUpdate }}>{children}</PwaContext.Provider>;
}

export function PwaUpdateNotice() {
  const { updateAvailable, applyUpdate, dismissUpdate } = usePwa();
  if (!updateAvailable) return null;
  return <div className="pwa-update" role="status">
    <RefreshCw size={19} aria-hidden="true" />
    <span>Hay una actualización disponible.</span>
    <div className="pwa-update-actions">
      <button type="button" className="button button-primary" onClick={applyUpdate}>Actualizar</button>
      <button type="button" className="button button-quiet" onClick={dismissUpdate}>Ahora no</button>
    </div>
  </div>;
}
