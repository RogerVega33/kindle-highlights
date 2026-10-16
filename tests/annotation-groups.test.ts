import assert from 'node:assert/strict';
import test from 'node:test';
import { groupAnnotations } from '../client/annotations.js';
import { FakeLibraryRepository } from './helpers/fake-library-repository.js';
import type { Annotation, ImportFile } from '../shared/types.js';

function annotation(
  id: string,
  sectionTitle: string | null,
  coordinates: Partial<Pick<Annotation, 'page' | 'location' | 'sourceOrder'>> = {},
): Annotation {
  const text = `Texto ${id}.`;
  return {
    id, bookId: 'libro-ficticio', kind: 'highlight', text, originalText: text, edited: false,
    page: null, location: null, color: 'yellow', sectionTitle, chapterTitle: null, sourceOrder: 1,
    ...coordinates,
  };
}

test('agrupa capítulos no consecutivos una sola vez en orden de primera aparición sin mutar la entrada', () => {
  const input = Object.freeze([
    annotation('a-tarde', 'Capítulo A', { location: 30, sourceOrder: 3 }),
    annotation('b', 'Capítulo B', { location: 20 }),
    annotation('a-antes', 'Capítulo A', { location: 10, sourceOrder: 1 }),
    annotation('sin-titulo-1', null, { page: 3, sourceOrder: 2 }),
    annotation('titulo-literal', 'sin-seccion', { page: 1 }),
    annotation('sin-titulo-2', null, { page: 2, sourceOrder: 1 }),
  ].map((entry) => Object.freeze(entry)));
  const before = structuredClone(input);

  const grouped = groupAnnotations(input);

  assert.deepEqual(grouped.map(({ title }) => title), ['Capítulo A', 'Capítulo B', null, 'sin-seccion']);
  assert.deepEqual(grouped.map(({ annotations }) => annotations.map(({ id }) => id)), [
    ['a-antes', 'a-tarde'], ['b'], ['sin-titulo-2', 'sin-titulo-1'], ['titulo-literal'],
  ]);
  assert.equal(new Set(grouped.map(({ id }) => id)).size, 4);
  assert.notEqual(grouped[2].id, grouped[3].id);
  assert.deepEqual(input, before);
});

test('ordena cada capítulo por posiciones o páginas comparables y conserva el orden de las unidades mixtas', () => {
  const input = Object.freeze([
    annotation('l20', 'Posiciones', { location: 20, page: 1, sourceOrder: 1 }),
    annotation('l10-segundo', 'Posiciones', { location: 10, page: 99, sourceOrder: 3 }),
    annotation('l10-primero', 'Posiciones', { location: 10, page: 90, sourceOrder: 2 }),
    annotation('p3', 'Páginas', { location: 30, page: 3, sourceOrder: 1 }),
    annotation('p1-segundo', 'Páginas', { page: 1, sourceOrder: 5 }),
    annotation('p1-primero', 'Páginas', { location: 10, page: 1, sourceOrder: 2 }),
    annotation('mixto-1', 'Mixto', { location: 30, sourceOrder: 3 }),
    annotation('mixto-2', 'Mixto', { page: 1, sourceOrder: 1 }),
    annotation('mixto-3', 'Mixto', { location: 10, sourceOrder: 2 }),
  ].map((entry) => Object.freeze(entry)));
  const before = structuredClone(input);

  const grouped = groupAnnotations(input);

  assert.deepEqual(grouped.map(({ annotations }) => annotations.map(({ id }) => id)), [
    ['l10-primero', 'l10-segundo', 'l20'],
    ['p1-primero', 'p1-segundo', 'p3'],
    ['mixto-1', 'mixto-2', 'mixto-3'],
  ]);
  assert.deepEqual(input, before);
});

test('los identificadores de los capítulos sobreviven a ediciones, filtros y cambios de la primera anotación', () => {
  const a1 = annotation('a1', 'Capítulo A', { page: 2 });
  const a2 = annotation('a2', 'Capítulo A', { page: 3 });
  const b = annotation('b', 'Capítulo B', { page: 4 });
  const n1 = annotation('n1', null, { page: 5 });
  const n2 = annotation('n2', null, { page: 6 });
  const literal1 = annotation('literal1', 'sin-seccion', { page: 7 });
  const literal2 = annotation('literal2', 'sin-seccion', { page: 8 });
  const input = [a1, b, a2, n1, n2, literal1, literal2];
  const original = groupAnnotations(input);
  const idsByTitle = new Map(original.map(({ title, id }) => [title, id]));
  assert.equal(new Set(idsByTitle.values()).size, 4);

  const variations = [
    [{ ...a1, text: 'Texto editado.', edited: true }, b, a2, n1, n2, literal1, literal2],
    [a2, n2, literal2, b],
    [literal2, n1, b, a2, a1, n2, literal1],
    [annotation('a0', 'Capítulo A', { page: 1 }), ...input],
  ];
  for (const entries of variations) {
    const groups = groupAnnotations(entries);
    assert.equal(groups.length, 4);
    for (const group of groups) assert.equal(group.id, idsByTitle.get(group.title));
  }
  assert.deepEqual(groupAnnotations([a2]).map(({ id }) => id), [idsByTitle.get('Capítulo A')]);
  assert.deepEqual(groupAnnotations([n2]).map(({ id }) => id), [idsByTitle.get(null)]);
  assert.deepEqual(groupAnnotations([]), []);
});

test('dos exportaciones ficticias mezcladas conservan 19 capítulos y 297 anotaciones sin duplicados', () => {
  function file(title: string, chapters: number, count: number, offset: number): ImportFile {
    let entries = '';
    for (let index = 0; index < count; index++) {
      entries += `<div class="sectionHeading">${title} — Capítulo ${Math.floor(index * chapters / count)}</div>`
        + `<div class="noteHeading">Subrayado - Posición ${index * 2 + offset}</div>`
        + `<div class="noteText">Texto ficticio ${title} ${index}.</div>`;
    }
    return { filename: `${title}.html`, html: `<div class="bookTitle">${title}</div><div class="authors">Autora ficticia</div>${entries}` };
  }
  const firstFile = file('Libro A', 9, 133, 1);
  const secondFile = file('Libro B', 10, 164, 2);
  const repository = new FakeLibraryRepository();
  const [first] = repository.importFiles([firstFile]);
  assert.equal(first.status, 'success');
  assert.equal(first.added, 133);
  assert.ok(first.bookId);
  const [second] = repository.importFiles([secondFile], first.bookId);
  assert.equal(second.status, 'success');
  assert.equal(second.added, 164);
  assert.equal(second.incomplete, 0);
  const before = repository.getBook(first.bookId);
  assert.equal(before.annotations.length, 297);
  const unchanged = structuredClone(before.annotations);

  const sections = groupAnnotations(before.annotations);
  assert.equal(sections.length, 19);
  assert.equal(new Set(sections.map(({ title }) => title)).size, 19);
  assert.equal(new Set(sections.map(({ id }) => id)).size, 19);
  assert.deepEqual(sections.map(({ title }) => title), [...new Set(before.annotations.map(({ sectionTitle }) => sectionTitle))]);
  const flattened = sections.flatMap(({ annotations }) => annotations);
  assert.equal(flattened.length, 297);
  assert.equal(new Set(flattened.map(({ id }) => id)).size, 297);
  const byId = (left: Annotation, right: Annotation) => left.id.localeCompare(right.id);
  assert.deepEqual([...flattened].sort(byId), [...before.annotations].sort(byId));
  assert.deepEqual(before.annotations, unchanged);
  for (const section of sections) {
    assert.ok(section.annotations.every(({ sectionTitle }) => sectionTitle === section.title));
    assert.ok(section.annotations.every(({ location }) => location !== null));
    assert.ok(section.annotations.every((entry, index, entries) => index === 0 || entry.location! >= entries[index - 1].location!));
  }

  const repeated = repository.importFiles([firstFile, secondFile], first.bookId);
  assert.deepEqual(repeated.map(({ added, repeated }) => ({ added, repeated })), [
    { added: 0, repeated: 133 }, { added: 0, repeated: 164 },
  ]);
  assert.equal(repository.listBooks().totalBooks, 1);
  assert.deepEqual(groupAnnotations(repository.getBook(first.bookId).annotations), sections);
});
