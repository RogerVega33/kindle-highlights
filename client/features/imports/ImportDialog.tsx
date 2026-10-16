import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { Check, CheckCircle2, CircleAlert, FileText, LoaderCircle, Plus, Upload, X } from 'lucide-react';
import type { Book, ImportFile, ImportResult } from '../../../shared/types';
import { MAX_HTML_BYTES } from '../../../shared/limits';
import { libraryApi } from '../../api/library';
import { Modal } from '../../components/Modal';
import { messageOf, plural } from '../../lib/format';

function ResultRow({ result }: { result: ImportResult }) {
  return (
    <div className={'result-row' + (result.status === 'error' ? ' result-row--error' : '')}>
      <div className="result-icon">{result.status === 'success' ? <CheckCircle2 size={19} /> : <CircleAlert size={19} />}</div>
      <div className="result-content">
        <strong>{result.bookTitle || result.filename}</strong>
        {result.bookTitle && <span className="result-filename">{result.filename}</span>}
        {result.status === 'error' ? (
          <p className="result-error">{result.error || 'No se pudo importar este archivo.'}</p>
        ) : (
          <p className="result-counts">
            <span>{plural(result.added, 'anotación nueva', 'anotaciones nuevas')}</span>
            <span>{plural(result.repeated, 'repetida', 'repetidas')}</span>
            {result.incomplete > 0 && <span className="incomplete">{plural(result.incomplete, 'incompleta', 'incompletas')}</span>}
          </p>
        )}
        {result.issues.length > 0 && (
          <details className="result-issues">
            <summary>Ver {plural(result.issues.length, 'observación', 'observaciones')}</summary>
            <ul>{result.issues.map((issue, index) => <li key={index}>{issue.entry > 0 ? 'Entrada ' + issue.entry + ': ' : ''}{issue.message}</li>)}</ul>
          </details>
        )}
      </div>
    </div>
  );
}

export function ImportDialog({ target, onClose, onImported }: {
  target: Book | null;
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [results, setResults] = useState<ImportResult[]>([]);
  const [finished, setFinished] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  function addFiles(incoming: File[]) {
    setError('');
    const problems: string[] = [];
    const valid = incoming.filter(file => {
      if (!/\.html?$/i.test(file.name)) {
        problems.push(file.name + ': selecciona un archivo HTML o HTM.');
        return false;
      }
      if (file.size > MAX_HTML_BYTES) {
        problems.push(`${file.name}: supera el límite de ${MAX_HTML_BYTES / 1024 / 1024} MB.`);
        return false;
      }
      if (file.size === 0) {
        problems.push(file.name + ': el archivo está vacío.');
        return false;
      }
      return true;
    });
    const merged = [...files];
    for (const file of valid) {
      if (!merged.some(item => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) merged.push(file);
    }
    setFiles(merged);
    if (problems.length) setError(problems.join('\n'));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!busy) addFiles(Array.from(event.dataTransfer.files));
  }

  async function startImport() {
    const chosen = files;
    if (!chosen.length || busy) return;
    setBusy(true);
    setFinished(false);
    setError('');
    setResults([]);
    setProgress({ current: 0, total: chosen.length });
    try {
      for (let index = 0; index < chosen.length; index++) {
        if (!active.current) return;
        setProgress({ current: index + 1, total: chosen.length });
        let next: ImportResult[];
        try {
          const file: ImportFile = { filename: chosen[index].name, html: await chosen[index].text() };
          if (!active.current) return;
          next = await libraryApi.importFiles([file], target?.id);
        } catch (cause) {
          next = [{
            filename: chosen[index].name, bookId: null, bookTitle: null, status: 'error',
            added: 0, repeated: 0, incomplete: 0, highlights: 0, notes: 0,
            issues: [], error: messageOf(cause),
          }];
        }
        setResults(previous => [...previous, ...next]);
      }
      if (active.current) await onImported();
    } finally {
      setBusy(false);
      setFinished(true);
    }
  }

  const totals = results.reduce((sum, result) => ({
    added: sum.added + result.added, repeated: sum.repeated + result.repeated, incomplete: sum.incomplete + result.incomplete,
  }), { added: 0, repeated: 0, incomplete: 0 });
  const importedBooks = new Set(results
      .filter(result => result.status === 'success' && result.bookId !== null)
      .map(result => result.bookId)).size;
  const selectedCount = files.length;
  const showingResults = busy || finished;

  return (
    <Modal
      title={showingResults ? (busy ? 'Importando tus anotaciones…' : 'Importación terminada') : target ? 'Añadir más a este libro' : 'Importar libros'}
      description={showingResults ? 'Tus portadas y anotaciones anteriores se conservan. Solo se agrega lo nuevo.' : target ? target.title : 'Importa tus subrayados y notas desde una exportación HTML de Kindle.'}
      onClose={() => { if (!busy) onClose(); }}
      className="import-modal"
    >
      {!showingResults ? (
        <>
          {target && <p className="import-target-notice" role="note"><CircleAlert size={16} aria-hidden="true" /><span>No se valida que los archivos correspondan a este libro.</span></p>}
          <input ref={input} type="file" accept=".html,.htm,text/html,application/xhtml+xml" multiple hidden aria-label="Seleccionar exportaciones HTML" onChange={event => { addFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
          <div className={'drop-zone' + (dragging ? ' is-dragging' : '')}
           onDragOver={event => { event.preventDefault(); setDragging(true); }}
           onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
           onDrop={handleDrop}>
            <span className="upload-symbol"><Upload size={25} strokeWidth={1.5} /></span>
            <p>Arrastra aquí tus exportaciones o elige los archivos.</p>
            <button type="button" className="button button-outline" onClick={() => input.current?.click()}><Plus size={16} /> Seleccionar archivos</button>
            <span className="file-hint">HTML o HTM · Hasta {MAX_HTML_BYTES / 1024 / 1024} MB por archivo</span>
          </div>
          {files.length > 0 && <div className="selected-files">
            <div className="selection-heading"><strong>{plural(files.length, 'archivo seleccionado', 'archivos seleccionados')}</strong><button type="button" className="text-button" onClick={() => setFiles([])}>Quitar todos</button></div>
            <div className="file-list">{files.map((file, index) => <div className="file-row" key={file.name + ':' + file.lastModified}>
              <FileText size={19} />
              <div><span>{file.name}</span><small>{Math.max(1, Math.round(file.size / 1024)).toLocaleString('es')} KB</small></div>
              <button type="button" className="icon-button" aria-label={'Quitar ' + file.name} onClick={() => setFiles(previous => previous.filter((_, current) => current !== index))}><X size={16} /></button>
            </div>)}</div>
          </div>}
          <p className="import-assurance"><Check size={15} /> {target ? 'Conservaremos lo existente y añadiremos solo tus nuevas anotaciones.' : 'Si vuelves a importar un libro, conservaremos lo existente y añadiremos solo sus nuevas anotaciones.'}</p>
          {error && <div className="inline-error preserve-lines" role="alert"><CircleAlert size={18} /><span>{error}</span></div>}
          <div className="modal-footer"><button type="button" className="button button-quiet" onClick={onClose}>Cancelar</button><button type="button" className="button button-primary" disabled={!selectedCount} onClick={() => void startImport()}><Upload size={17} /> Importar{selectedCount > 0 ? ' ' + plural(selectedCount, 'archivo', 'archivos') : ''}</button></div>
        </>
      ) : (
        <>
          <div className="import-summary" aria-live="polite">
            <div><strong>{importedBooks.toLocaleString('es')}</strong><span>{importedBooks === 1 ? 'Libro' : 'Libros'}</span></div>
            <div><strong>{totals.added.toLocaleString('es')}</strong><span>{totals.added === 1 ? 'Anotación nueva' : 'Anotaciones nuevas'}</span></div>
            <div><strong>{totals.repeated.toLocaleString('es')}</strong><span>{totals.repeated === 1 ? 'Anotación repetida' : 'Anotaciones repetidas'}</span></div>
            {totals.incomplete > 0 && <div className="has-warning"><strong>{totals.incomplete.toLocaleString('es')}</strong><span>{totals.incomplete === 1 ? 'Anotación incompleta' : 'Anotaciones incompletas'}</span></div>}
          </div>
          {busy && <div className="import-progress" role="status"><span><LoaderCircle size={15} className="spin" /> Procesando archivo {progress.current} de {progress.total}</span><div className="progress-track"><span style={{ width: ((progress.current - 1) / Math.max(progress.total, 1)) * 100 + '%' }} /></div></div>}
          <div className="import-results">{results.map((result, index) => <ResultRow result={result} key={index} />)}</div>
          {totals.incomplete > 0 && <p className="result-footnote">Algunas entradas necesitan revisión. Consulta las observaciones de cada archivo.</p>}
          {finished && results.some(result => result.status === 'error') && <p className="result-footnote">Los archivos con errores no impiden importar los demás. Puedes volver a intentarlo con esos archivos.</p>}
          <div className="modal-footer"><button type="button" className="button button-primary" disabled={busy} onClick={onClose}>{busy ? <><LoaderCircle size={16} className="spin" /> Importando…</> : <><Check size={17} /> Listo</>}</button></div>
        </>
      )}
    </Modal>
  );
}
