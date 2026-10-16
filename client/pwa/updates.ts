interface UpdateWorker extends EventTarget {
  state: ServiceWorkerState;
  postMessage: (message: unknown) => void;
}

interface UpdateRegistration extends EventTarget {
  installing: UpdateWorker | null;
  waiting: UpdateWorker | null;
}

interface UpdateContainer extends EventTarget {
  controller: unknown;
}

/** Installation is silent. Only an update to an already controlled app is announced. */
export function watchPwaUpdates(registration: UpdateRegistration, workers: UpdateContainer, onAvailable: () => void, reload: () => void) {
  const tracked = new Map<UpdateWorker, () => void>();
  const announced = new Set<UpdateWorker>();
  let approved = false;
  let previousController = workers.controller;
  let activatedElsewhere = false;

  function announce(worker: UpdateWorker) {
    if (!workers.controller || announced.has(worker)) return;
    announced.add(worker);
    onAvailable();
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
    } else if (replaced && !activatedElsewhere) {
      activatedElsewhere = true;
      if (!announced.size) onAvailable();
    }
  }

  registration.addEventListener('updatefound', watchInstalling);
  workers.addEventListener('controllerchange', controllerChanged);
  if (registration.waiting) announce(registration.waiting);
  watchInstalling();

  return {
    apply() {
      if (approved) return false;
      if (!registration.waiting) {
        if (!activatedElsewhere) return false;
        activatedElsewhere = false;
        reload();
        return true;
      }
      approved = true;
      try { registration.waiting.postMessage({ type: 'SKIP_WAITING' }); return true; }
      catch { approved = false; return false; }
    },
    dispose() {
      approved = false;
      registration.removeEventListener('updatefound', watchInstalling);
      workers.removeEventListener('controllerchange', controllerChanged);
      tracked.forEach((listener, worker) => worker.removeEventListener('statechange', listener));
    },
  };
}
