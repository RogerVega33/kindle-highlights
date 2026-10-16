import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeCover } from '../server/covers.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6u4AAAAASUVORK5CYII=', 'base64');

test('una portada PNG etiquetada como JPEG conserva sus bytes y se sirve como PNG', () => {
  const result = decodeCover(`data:image/jpeg;base64,${png.toString('base64')}`);
  assert.equal(result.mime, 'image/png');
  assert.deepEqual(result.bytes, png);
});

test('la firma JPEG se reconoce aunque el navegador declare PNG', () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x02, 0xff, 0xd9]);
  const result = decodeCover(`data:image/png;base64,${bytes.toString('base64')}`);
  assert.equal(result.mime, 'image/jpeg');
  assert.deepEqual(result.bytes, bytes);
});

test('corregir el tipo declarado no permite texto, SVG ni JPEG sin marcador final', () => {
  for (const bytes of [Buffer.from('texto'), Buffer.from('<svg></svg>'), Buffer.from([0xff, 0xd8, 0xff, 0xe1])]) {
    assert.throws(() => decodeCover(`data:image/png;base64,${bytes.toString('base64')}`));
  }
});
