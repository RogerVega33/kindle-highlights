import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const publicAssets = ['favicon.svg', 'pwa-192.png', 'pwa-512.png', 'pwa-maskable-512.png', 'apple-touch-icon.png'];
const versionPlaceholder = '__KINDLE_PWA_VERSION__';

export function pwaBuild(): Plugin {
  let root = '';
  return {
    name: 'kindle-pwa',
    apply: 'build',
    enforce: 'post',
    configResolved(config) { root = config.root; },
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { name: 'app-version', content: versionPlaceholder }, injectTo: 'head' }];
    },
    generateBundle: {
      order: 'post',
      async handler(_options, bundle) {
        const template = await readFile(join(root, 'pwa/service-worker.js'), 'utf8');
        const hash = createHash('sha256').update(template);
        const files = Object.keys(bundle).sort();
        for (const filename of files) {
          const output = bundle[filename];
          hash.update(filename).update(output.type === 'chunk' ? output.code : output.source);
        }
        for (const filename of [...publicAssets, 'manifest.webmanifest']) {
          hash.update(filename).update(await readFile(join(root, 'public', filename)));
        }
        const assets = ['/', ...files.filter(name => name.startsWith('assets/')).map(name => '/' + name), ...publicAssets.map(name => '/' + name)];
        const config = { cacheName: 'kindle-highlights-static-' + hash.digest('hex').slice(0, 16), assets };
        const html = bundle['index.html'];
        if (html?.type === 'asset') {
          const source = typeof html.source === 'string' ? html.source : Buffer.from(html.source).toString('utf8');
          html.source = source.replace(versionPlaceholder, config.cacheName);
        }
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: template.replace('__PWA_CONFIG__', JSON.stringify(config)) });
      },
    },
  };
}
