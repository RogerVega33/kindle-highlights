export function fakeBrowser(path = '/', state: unknown = null) {
  const entries = [{ url: new URL(path, 'https://example.test'), state }];
  let index = 0;
  const listeners = new Set<() => void>();
  const visit = (next: number) => {
    if (next < 0 || next >= entries.length) return;
    index = next;
    listeners.forEach(listener => listener());
  };
  const browser = {
    get location() { return entries[index].url; },
    history: {
      get state() { return entries[index].state; },
      replaceState(nextState: unknown, _title: string, url?: string | URL | null) {
        entries[index] = { state: nextState, url: new URL(url?.toString() ?? entries[index].url, entries[index].url) };
      },
      pushState(nextState: unknown, _title: string, url?: string | URL | null) {
        const next = { state: nextState, url: new URL(url?.toString() ?? entries[index].url, entries[index].url) };
        entries.splice(++index, entries.length, next);
      },
      back() { visit(index - 1); },
      forward() { visit(index + 1); },
    },
    addEventListener(_type: 'popstate', listener: () => void) { listeners.add(listener); },
    removeEventListener(_type: 'popstate', listener: () => void) { listeners.delete(listener); },
  };
  return { browser, entries, listeners };
}
