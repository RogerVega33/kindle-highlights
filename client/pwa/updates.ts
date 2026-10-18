interface UpdateWorker extends EventTarget {
  state: ServiceWorkerState;
  postMessage(message: unknown): void;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

interface UpdateRegistration extends EventTarget {
  installing: UpdateWorker | null;
  waiting: UpdateWorker | null;
}

interface UpdateContainer extends EventTarget {
  controller: UpdateWorker | null;
}

function readVersion(worker: UpdateWorker, signal: AbortSignal): Promise<string | null> {
  if (signal.aborted || typeof MessageChannel === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    const channel = new MessageChannel();
    let settled = false;
    function finish(version: string | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', aborted);
      channel.port1.close();
      channel.port2.close();
      resolve(version);
    }
    function aborted() { finish(null); }
    const timeout = setTimeout(aborted, 1500);
    signal.addEventListener('abort', aborted, { once: true });
    channel.port1.onmessage = event => finish(typeof event.data?.version === 'string' ? event.data.version : null);
    try { worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]); }
    catch { finish(null); }
  });
}

/** A page already on the waiting worker's build can activate it without another reload. */
export function watchPwaUpdates(registration: UpdateRegistration, workers: UpdateContainer, onAvailable: () => void, reload: () => void,
  options: { version?: string; onCurrent?: () => void } = {}) {
  const tracked = new Map<UpdateWorker, () => void>();
  const announced = new Set<UpdateWorker>();
  const checked = new Set<UpdateWorker>();
  const current = new Set<UpdateWorker>();
  const versions = new Map<UpdateWorker, Promise<string | null>>();
  const requests = new AbortController();
  let disposed = false;
  let approved = false;
  let previousController = workers.controller;
  let activatedElsewhere: UpdateWorker | null = null;

  function showUpdate(worker: UpdateWorker) {
    if (announced.has(worker)) return;
    announced.add(worker);
    onAvailable();
  }

  function checkVersion(worker: UpdateWorker, done: (matches: boolean) => void) {
    if (!options.version) { done(false); return; }
    let version = versions.get(worker);
    if (!version) {
      version = readVersion(worker, requests.signal);
      versions.set(worker, version);
    }
    void version.then(value => { if (!disposed) done(value === options.version); });
  }

  function announce(worker: UpdateWorker) {
    if (!workers.controller || checked.has(worker)) return;
    checked.add(worker);
    checkVersion(worker, matches => {
      if (worker.state === 'redundant' || workers.controller === worker
        || (registration.waiting !== worker && registration.installing !== worker)) return;
      if (!matches) { showUpdate(worker); return; }
      current.add(worker);
      // Other tabs receive controllerchange, but only pages on an older build offer a reload.
      try { worker.postMessage({ type: 'SKIP_WAITING' }); } catch { return; }
      activatedElsewhere = null;
      options.onCurrent?.();
    });
  }

  function watchInstalling() {
    const worker = registration.installing;
    if (!worker || tracked.has(worker)) return;
    const changed = () => { if (worker.state === 'installed') announce(worker); };
    tracked.set(worker, changed);
    worker.addEventListener('statechange', changed);
    changed();
  }

  function controllerChanged() {
    const replaced = previousController && workers.controller && previousController !== workers.controller;
    previousController = workers.controller;
    if (approved) {
      approved = false;
      reload();
    } else if (replaced) {
      const controller = workers.controller!;
      if (current.has(controller)) return;
      checkVersion(controller, matches => {
        if (workers.controller !== controller) return;
        if (matches) {
          current.add(controller);
          activatedElsewhere = null;
          if (!registration.waiting) options.onCurrent?.();
        } else {
          activatedElsewhere = controller;
          showUpdate(controller);
        }
      });
    }
  }

  registration.addEventListener('updatefound', watchInstalling);
  workers.addEventListener('controllerchange', controllerChanged);
  if (registration.waiting) announce(registration.waiting);
  watchInstalling();

  return {
    apply() {
      if (disposed || approved) return false;
      if (!registration.waiting) {
        if (!activatedElsewhere) return false;
        activatedElsewhere = null;
        reload();
        return true;
      }
      approved = true;
      try { registration.waiting.postMessage({ type: 'SKIP_WAITING' }); return true; }
      catch { approved = false; return false; }
    },
    dispose() {
      disposed = true;
      requests.abort();
      approved = false;
      registration.removeEventListener('updatefound', watchInstalling);
      workers.removeEventListener('controllerchange', controllerChanged);
      tracked.forEach((listener, worker) => worker.removeEventListener('statechange', listener));
    },
  };
}
