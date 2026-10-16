import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { parseKindleHtml } from '../server/parser.js';
import { notebook, originalNotebook, expandedNotebook } from './helpers/notebooks.js';

test('una exportación ficticia conserva texto, nota multilínea, páginas y color', () => {
  const parsed = parseKindleHtml(originalNotebook.html);
  assert.equal(parsed.title, 'Cuaderno de prueba');
  assert.equal(parsed.author, 'Autora ficticia');
  assert.equal(parsed.incomplete, 0);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.annotations.map(({ kind }) => kind), ['highlight', 'note', 'highlight']);
  assert.deepEqual(parsed.annotations.map(({ page }) => page), [7, 7, 9]);
  assert.ok(parsed.annotations.every(({ location }) => location === null));
  assert.deepEqual(parsed.annotations.map(({ text }) => text), [
    'Primer texto de prueba.', 'Primera línea.\nSegunda línea.\n\nCierre.', 'Segundo texto de prueba.',
  ]);
  assert.equal(parsed.annotations[0].color, 'yellow');
  assert.equal(parsed.annotations[2].color, 'yellow');
  assert.ok(parsed.annotations.every(({ sectionTitle }) => sectionTitle === 'Sección de prueba'));
  assert.ok(parsed.annotations.every((entry, index, entries) => index === 0 || entry.sourceOrder > entries[index - 1].sourceOrder));
});

test('una exportación ampliada conserva dos subrayados distintos en la misma página', () => {
  const parsed = parseKindleHtml(expandedNotebook.html);
  const samePage = parsed.annotations.filter(({ kind, page }) => kind === 'highlight' && page === 9);
  assert.equal(parsed.annotations.length, 4);
  assert.equal(samePage.length, 2);
  assert.notEqual(samePage[0].text, samePage[1].text);
  assert.equal(samePage[1].text, 'Tercer texto de prueba.');
});

test('se interpretan página, posición, ambas coordenadas y encabezados en inglés', () => {
  const entries = [
    '<div class="noteHeading">Subrayado - Página 10</div><div class="noteText">Página.</div>',
    '<div class="noteHeading">Subrayado - Capítulo ficticio > Posición 634</div><div class="noteText">Posición.</div>',
    '<div class="noteHeading">Subrayado - Página 6 · Posición 290</div><div class="noteText">Ambas.</div>',
    '<div class="noteHeading">Highlight - Page 8 · Location 1,234</div><div class="noteText">English highlight.</div>',
    '<div class="noteHeading">Note - Location 2.345</div><div class="noteText">English note.</div>',
  ];
  const parsed = parseKindleHtml(notebook('<div class="sectionHeading">Capítulo de prueba</div>' + entries.join('')));
  assert.equal(parsed.incomplete, 0);
  assert.deepEqual(parsed.annotations.map(({ page, location }) => ({ page, location })), [
    { page: 10, location: null }, { page: null, location: 634 }, { page: 6, location: 290 },
    { page: 8, location: 1234 }, { page: null, location: 2345 },
  ]);
  assert.equal(parsed.annotations[1].chapterTitle, 'Capítulo ficticio');
  assert.ok(parsed.annotations.every(({ sectionTitle }) => sectionTitle === 'Capítulo de prueba'));
  assert.equal(parsed.annotations[3].kind, 'highlight');
  assert.equal(parsed.annotations[4].kind, 'note');
});

test('las coordenadas se leen después del capítulo sin confundir sus números o separadores', () => {
  const cases = [
    { heading: 'Subrayado - Location 1984 > Location 400', chapterTitle: 'Location 1984', page: null, location: 400 },
    { heading: 'Subrayado - Página 12 > Página 99 · Posición 100', chapterTitle: 'Página 12', page: 99, location: 100 },
    { heading: 'Subrayado - Parte I - La ruta > El regreso > Posición 350', chapterTitle: 'Parte I - La ruta > El regreso', page: null, location: 350 },
    { heading: '  Highlight   -   Part - One  >  Location   750  ', chapterTitle: 'Part - One', page: null, location: 750 },
    { heading: 'Subrayado - > Posición 800', chapterTitle: null, page: null, location: 800 },
    { heading: 'Nota - Página 20 · Posición 900', chapterTitle: null, page: 20, location: 900 },
  ];
  const parsed = parseKindleHtml(notebook(cases.map(({ heading }, index) =>
    `<div class="noteHeading">${heading}</div><div class="noteText">Texto ficticio ${index + 1}.</div>`).join('')));

  assert.equal(parsed.incomplete, 0);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.annotations.map(({ chapterTitle, page, location }) => ({ chapterTitle, page, location })),
    cases.map(({ chapterTitle, page, location }) => ({ chapterTitle, page, location })));
});

test('las coordenadas del capítulo no completan una entrada cuyo sufijo carece de coordenadas', () => {
  const parsed = parseKindleHtml(notebook(`
    <div class="noteHeading">Subrayado - Location 1984 > Sin coordenadas</div>
    <div class="noteText">No debe importarse la posición del capítulo.</div>
    <div class="noteHeading">Subrayado - Página 12 > Sin coordenadas</div>
    <div class="noteText">No debe importarse la página del capítulo.</div>
    <div class="noteHeading">Subrayado - Capítulo - incompleto ></div>
    <div class="noteText">El separador sin coordenadas requiere revisión.</div>
    <div class="noteHeading">Nota - Posición 500</div>
    <div class="noteText">La entrada siguiente se conserva.</div>
  `));

  assert.equal(parsed.incomplete, 3);
  assert.deepEqual(parsed.issues.map(({ entry }) => entry), [1, 2, 3]);
  assert.deepEqual(parsed.annotations.map(({ page, location, text }) => ({ page, location, text })), [
    { page: null, location: 500, text: 'La entrada siguiente se conserva.' },
  ]);
});

test('los encabezados con muchos guiones se procesan hasta el límite de HTML sin bloquear el proceso', async t => {
  // A worker can be terminated if a quadratic regression blocks its event loop.
  // This is a generous completion bound, not a millisecond benchmark.
  const script = `
    const assert = require('node:assert/strict');
    const { require: tsxRequire } = require(${JSON.stringify(createRequire(import.meta.url).resolve('tsx/cjs/api'))});
    const { parseKindleHtml } = tsxRequire('../server/parser.ts', ${JSON.stringify(import.meta.url)});
    const { MAX_HTML_BYTES } = tsxRequire('../shared/limits.ts', ${JSON.stringify(import.meta.url)});
    const { notebook } = tsxRequire('./helpers/notebooks.ts', ${JSON.stringify(import.meta.url)});

    const prefix = '<div class="noteHeading">Subrayado - ';
    const suffix = '</div><div class="noteText">Texto ficticio sin coordenadas.</div>';
    const fixedBytes = Buffer.byteLength(notebook(prefix + suffix), 'utf8');
    for (const size of [32 * 1024, MAX_HTML_BYTES]) {
      const html = notebook(prefix + '-'.repeat(size - fixedBytes) + suffix);
      assert.equal(Buffer.byteLength(html, 'utf8'), size);
      const parsed = parseKindleHtml(html);
      assert.equal(parsed.annotations.length, 0);
      assert.equal(parsed.incomplete, 1);
      assert.equal(parsed.issues.length, 1);
    }
  `;
  const worker = new Worker(script, { eval: true, execArgv: [], env: {} });
  t.after(async () => { await worker.terminate(); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('El parser no terminó en 10 segundos.')), 10_000);
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`La comprobación del parser terminó con código ${code}.`));
    });
  });
});

test('un lote de subrayados vacíos se ignora sin perder el contenido posterior', () => {
  const empty = Array.from({ length: 29 }, (_, index) =>
    `<div class="noteHeading">Subrayado - Posición ${index + 1}</div><div class="noteText"> </div>`).join('');
  const parsed = parseKindleHtml(notebook(empty
    + '<div class="noteHeading">Subrayado - Posición 406</div><div class="noteText">Texto posterior conservado.</div>'));
  assert.equal(parsed.incomplete, 0);
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.annotations.length, 1);
  assert.equal(parsed.annotations[0].location, 406);
  assert.equal(parsed.annotations[0].text, 'Texto posterior conservado.');
});

test('un marcador o un subrayado vacío no roba el texto del siguiente encabezado', () => {
  const parsed = parseKindleHtml(notebook(`
    <div class="noteHeading">Marcador - Posición 5</div>
    <div class="noteHeading">Subrayado (<span class="highlight_yellow">amarillo</span>) - Posición 6</div>
    <div class="noteText">Este texto pertenece solo a la posición seis.</div>
    <div class="noteHeading">Subrayado (amarillo) - Posición 7</div>
    <div class="noteText"> </div>
    <div class="noteHeading">Nota - Posición 8</div>
    <div class="noteText">Una nota independiente.</div>
  `));

  assert.equal(parsed.incomplete, 0);
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.annotations.length, 2);
  assert.deepEqual(parsed.annotations.map(({ kind, text, location }) => ({ kind, text, location })), [
    { kind: 'highlight', text: 'Este texto pertenece solo a la posición seis.', location: 6 },
    { kind: 'note', text: 'Una nota independiente.', location: 8 },
  ]);
});

test('el parser conserva párrafos, saltos y entidades como texto sin ejecutar scripts', () => {
  const sentinel = '__kindleParserTestExecuted';
  const globals = globalThis as typeof globalThis & Record<string, unknown>;
  delete globals[sentinel];
  const parsed = parseKindleHtml(notebook(`
    <script>globalThis.${sentinel} = true</script>
    <div class="noteHeading">Nota - Página 8 · Posición 25</div>
    <div class="noteText"><p>Primer párrafo &amp; compañía.</p><p>Segundo<br>Tercero</p><script>globalThis.${sentinel} = true</script></div>
  `));

  assert.equal(globals[sentinel], undefined);
  assert.equal(parsed.annotations.length, 1);
  const text = parsed.annotations[0].text ?? '';
  assert.match(text, /^Primer párrafo & compañía\.\n+Segundo\nTercero$/);
  assert.ok(!text.includes('<p>'));
  assert.ok(!text.includes(sentinel));
});

test('HTML ajeno a Kindle y documentos sin metadatos se rechazan', () => {
  assert.throws(() => parseKindleHtml('<!doctype html><html><body>Una página cualquiera</body></html>'));
  assert.throws(() => parseKindleHtml('<div class="noteHeading">Subrayado - Página 1</div><div class="noteText">Sin libro</div>'));
  assert.throws(() => parseKindleHtml(''));
});

test('se ignoran espacios, selecciones de imagen y notas vacías conservando la entrada siguiente', () => {
  const parsed = parseKindleHtml(notebook(`
    <div class="noteHeading">Subrayado - Posición 1</div><div class="noteText">&nbsp; <br>\t</div>
    <div class="noteHeading">Subrayado - Posición 2</div><div class="noteText"><img src="imagen.png" alt="Imagen"></div>
    <div class="noteHeading">Subrayado - Posición 3</div>
    <div class="noteHeading">Nota - Página 3</div><div class="noteText"><p>&nbsp;</p><br></div>
    <div class="noteHeading">Marcador - Posición 4</div>
    <div class="noteHeading">Subrayado - Posición 5</div><div class="noteText">Contenido conservado.</div>
  `));

  assert.equal(parsed.incomplete, 0);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.annotations.map(({ kind, text, location }) => ({ kind, text, location })), [
    { kind: 'highlight', text: 'Contenido conservado.', location: 5 },
  ]);
});

test('los marcadores se ignoran con texto, sin coordenadas y en ambos idiomas', () => {
  const parsed = parseKindleHtml(notebook(`
    <div class="noteHeading">Marcador - Página 1</div><div class="noteText">Contexto que no se importa.</div>
    <div class="noteHeading">Bookmark - Location 2</div><div class="noteText">Another ignored context.</div>
    <div class="noteHeading">Marcador</div><div class="noteText">También se ignora sin página ni posición.</div>
    <div class="noteHeading">Bookmark</div>
    <div class="noteHeading">Nota - Página 4</div><div class="noteText">Esta nota sí se conserva.</div>
  `));

  assert.equal(parsed.incomplete, 0);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.annotations.map(({ kind, text, page }) => ({ kind, text, page })), [
    { kind: 'note', text: 'Esta nota sí se conserva.', page: 4 },
  ]);
});

test('una entrada sin coordenadas verificables se reporta como incompleta', () => {
  const parsed = parseKindleHtml(notebook(`
    <div class="noteHeading">Subrayado (amarillo)</div>
    <div class="noteText">No debe inventarse una página o posición.</div>
  `));

  assert.equal(parsed.annotations.length, 0);
  assert.equal(parsed.incomplete, 1);
  assert.equal(parsed.issues.length, 1);
});
