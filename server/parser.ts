import { load, type CheerioAPI } from 'cheerio';
import type { AnnotationKind, HighlightColor, ImportIssue } from '../shared/types.js';

export interface ParsedAnnotation {
  kind: AnnotationKind;
  text: string | null;
  page: number | null;
  location: number | null;
  color: HighlightColor;
  sectionTitle: string | null;
  chapterTitle: string | null;
  sourceOrder: number;
}

export interface ParsedBook {
  title: string;
  author: string;
  annotations: ParsedAnnotation[];
  issues: ImportIssue[];
  incomplete: number;
}

// Only interpreted text reaches the API. Cheerio never executes scripts or loads URLs.
function elementText($: CheerioAPI, selection: ReturnType<CheerioAPI>, multiline = false): string {
  const copy = selection.clone();
  copy.find('script, style, noscript, iframe, object, embed, template').remove();
  copy.find('br').replaceWith('\n');
  copy.find('p, div, li, blockquote, pre').each((_, node) => { $(node).append('\n\n'); });
  const text = copy.text().replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').normalize('NFC');
  return multiline
    ? text.replace(/[\t\f\v ]+/g, ' ').replace(/ *\n */g, '\n').trim()
    : text.replace(/\s+/g, ' ').trim();
}

function locator(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (!match) return null;
  const value = Number(match[1].replace(/[.,]/g, ''));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

type SourceAnnotationKind = AnnotationKind | 'bookmark';

function annotationKind(heading: string): SourceAnnotationKind | null {
  if (/^(?:Subrayado|Highlight)\b/i.test(heading)) return 'highlight';
  if (/^(?:Nota|Note)\b/i.test(heading)) return 'note';
  if (/^(?:Marcador|Bookmark)\b/i.test(heading)) return 'bookmark';
  return null;
}

export function parseKindleHtml(html: string): ParsedBook {
  if (typeof html !== 'string' || !html.trim()) throw new Error('El archivo HTML está vacío.');
  const $ = load(html);
  $('script, style, noscript, iframe, object, embed, template').remove();
  const title = elementText($, $('.bookTitle').first());
  const author = elementText($, $('.authors').first());
  if (!title || !author) throw new Error('No se encontró el título y el autor de una exportación Kindle.');

  const result: ParsedBook = { title, author, annotations: [], issues: [], incomplete: 0 };
  let sectionTitle: string | null = null;
  let entry = 0;
  let pending: { annotation: Omit<ParsedAnnotation, 'kind' | 'text'>; kind: SourceAnnotationKind | null; texts: string[]; entry: number } | null = null;

  function finish(): void {
    if (!pending) return;
    const current = pending;
    pending = null;
    const text = current.texts.filter(Boolean).join('\n\n') || null;
    // This library collects highlighted text and notes; page bookmarks and empty entries are ignored.
    if (current.kind === 'bookmark' || !text) return;
    let problem: string | null = null;
    if (!current.kind) problem = 'Tipo de anotación no reconocido.';
    else if (current.annotation.page === null && current.annotation.location === null) problem = 'La anotación no contiene página ni posición; requiere revisión.';
    if (problem) {
      result.incomplete += 1;
      result.issues.push({ entry: current.entry, message: problem });
      return;
    }
    result.annotations.push({ ...current.annotation, kind: current.kind!, text });
  }

  $('.sectionHeading, .noteHeading, .noteText').each((_, node) => {
    const element = $(node);
    if (element.hasClass('sectionHeading')) {
      finish();
      sectionTitle = elementText($, element) || null;
      return;
    }
    if (element.hasClass('noteHeading')) {
      finish();
      entry += 1;
      const heading = elementText($, element);
      const classes = element.find('[class]').toArray().map(child => $(child).attr('class') || '').join(' ');
      const colorMatch = classes.match(/(?:highlight|annotation)_(yellow|blue|pink|orange)\b/);
      // Scan delimiters once: a regex retrying from every hyphen can block on long headings.
      // Coordinates follow the final ">"; numbers in chapter names are not locators.
      const separator = heading.lastIndexOf('>');
      const coordinates = separator < 0 ? heading : heading.slice(separator + 1);
      const dash = separator < 0 ? -1 : heading.indexOf('-');
      const chapterTitle = dash >= 0 && dash < separator
        ? heading.slice(dash + 1, separator).trim() || null
        : null;
      pending = {
        kind: annotationKind(heading),
        texts: [],
        entry,
        annotation: {
          page: locator(coordinates, /(?:P[aá]gina|Page)\s+(\d[\d.,]*)/i),
          location: locator(coordinates, /(?:Posici[oó]n|Location)\s+(\d[\d.,]*)/i),
          color: (colorMatch?.[1] as HighlightColor) || null,
          sectionTitle,
          chapterTitle,
          sourceOrder: entry,
        },
      };
      return;
    }
    if (pending) pending.texts.push(elementText($, element, true));
  });
  finish();
  if (!entry) throw new Error('No se encontraron anotaciones Kindle reconocibles en el archivo.');
  return result;
}
