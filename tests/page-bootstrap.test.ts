import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const bootstrap = /<script>\s*([\s\S]*?)<\/script>/.exec(html)![1];

test('el arranque desactiva la restauración automática de scroll antes de cargar React y conserva el tema', () => {
  for (const theme of ['light', 'dark']) {
    const history = { scrollRestoration: 'auto', state: { kindleAuthNavigation: { screen: 'register' } } };
    const documentElement = { dataset: {} as Record<string, string>, style: { colorScheme: '' } };
    const metadata = new Map<string, { content: string }>([
      ['meta[name="theme-color"]', { content: '#faf8f3' }],
      ['meta[name="color-scheme"]', { content: 'light' }],
    ]);
    vm.runInNewContext(bootstrap, {
      history,
      localStorage: { getItem: () => theme },
      document: { documentElement, querySelector: (selector: string) => metadata.get(selector) },
    });
    assert.equal(history.scrollRestoration, 'manual');
    assert.deepEqual(history.state, { kindleAuthNavigation: { screen: 'register' } });
    assert.equal(documentElement.dataset.theme, theme);
    assert.equal(documentElement.style.colorScheme, theme);
    assert.equal(metadata.get('meta[name="theme-color"]')!.content, theme === 'dark' ? '#111925' : '#faf8f3');
  }
});

test('el arranque admite navegadores sin scrollRestoration ni almacenamiento disponible', () => {
  const history = {};
  const documentElement = { dataset: {} as Record<string, string>, style: { colorScheme: '' } };
  vm.runInNewContext(bootstrap, {
    history,
    localStorage: { getItem: () => { throw new Error('Almacenamiento ficticio bloqueado'); } },
    document: { documentElement, querySelector: () => ({ content: '' }) },
  });
  assert.equal('scrollRestoration' in history, false);
  assert.equal(documentElement.dataset.theme, 'light');
});
