import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const publicAssets = ['favicon.svg', 'pwa-192.png', 'pwa-512.png', 'pwa-maskable-512.png', 'apple-touch-icon.png'];

export function pwaBuild(): Plugin {
  let root = '';
  return {
    name: 'kindle-pwa',
    apply: 'build',
    enforce: 'post',
    configResolved(config) { root = config.root; },
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
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: template.replace('__PWA_CONFIG__', JSON.stringify(config)) });
      },
    },
  };
}
