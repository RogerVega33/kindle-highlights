import type { ImportFile } from '../../shared/types.js';

// Fictitious Kindle-shaped data. No dependency on personal exports or filesystem paths.
export function notebook(entries: string, title = 'Cuaderno de prueba', author = 'Autora ficticia'): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <div class="bookTitle">${title}</div><div class="authors">${author}</div>${entries}
  </body></html>`;
}

const entries = `
  <div class="sectionHeading">Sección de prueba</div>
  <div class="noteHeading">Subrayado (<span class="annotation_yellow">amarillo</span>) - Página 7</div>
  <div class="noteText">Primer texto de prueba.</div>
  <div class="noteHeading">Nota - Página 7</div>
  <div class="noteText">Primera línea.<br>Segunda línea.<br><br>Cierre.</div>
  <div class="noteHeading">Subrayado (<span class="annotation_yellow">amarillo</span>) - Página 9</div>
  <div class="noteText">Segundo texto de prueba.</div>`;

export const originalNotebook: ImportFile = { filename: 'cuaderno.html', html: notebook(entries) };
export const expandedNotebook: ImportFile = {
  filename: 'cuaderno-ampliado.html',
  html: notebook(entries + `
    <div class="noteHeading">Subrayado (<span class="annotation_yellow">amarillo</span>) - Página 9</div>
    <div class="noteText">Tercer texto de prueba.</div>`),
};
