import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from 'cheerio';
import type { Annotation } from '../shared/types.js';
import { OriginalAnnotationDialog } from '../client/features/annotations/AnnotationDialogs.js';
import { AnnotationCard } from '../client/features/annotations/AnnotationCard.js';

const annotation: Annotation = {
  id: 'nota-ficticia', bookId: 'libro-ficticio', kind: 'note', text: 'Última edición.',
  originalText: 'Texto original.\n\nOtro párrafo.', edited: true, page: 7, location: null,
  color: null, sectionTitle: null, chapterTitle: null, sourceOrder: 1,
};

function dialog(value: Annotation) {
  return load(renderToStaticMarkup(createElement(OriginalAnnotationDialog, {
    annotation: value, onClose() {}, onRestored() {}, returnFocusFallbackRef: { current: null },
  })));
}

test('el diálogo de notas y subrayados muestra el original y permite restaurarlo', () => {
  for (const kind of ['note', 'highlight'] as const) {
    const html = dialog({ ...annotation, kind });
    assert.equal(html('h2').text(), kind === 'note' ? 'Nota original' : 'Subrayado original');
    assert.equal(html('.original-annotation-text').text(), annotation.originalText);
    assert.equal(html('.modal-footer .button-primary').text(), 'Restaurar');
    assert.equal(html('.modal-footer .button-quiet').text(), 'Cerrar');
    assert.equal(html('body').text().includes('Última edición.'), false);
  }
});

test('un original sin texto nunca muestra la edición como si fuera el original', () => {
  const html = dialog({ ...annotation, originalText: null });
  assert.equal(html('.original-annotation-text').text(), 'Esta entrada no incluye texto en la exportación.');
  assert.equal(html('.modal-footer .button-primary').text(), 'Restaurar');
});

test('la anotación restaurada muestra el original sin marca editado ni acción Restaurar', () => {
  const restored = { ...annotation, text: annotation.originalText, edited: false };
  const html = load(renderToStaticMarkup(createElement(AnnotationCard, {
    annotation: restored, onCopy() {}, onDelete() {}, onEdit() {}, onShowOriginal() {},
  })));
  assert.equal(html('.annotation-text').text(), annotation.originalText);
  assert.equal(html('.annotation-edited').length, 0);
  assert.equal(dialog(restored)('.modal-footer button').text(), 'Cerrar');
});
