import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Copy, KeyRound } from 'lucide-react';
import { ErrorNotice } from '../../components/ErrorNotice';

export function RecoveryPhraseView({ username, phrase, reason, onContinue }: {
  username: string; phrase: string; reason: 'register' | 'recover'; onContinue: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(phrase);
      setCopied(true); setCopyError('');
    } catch { setCopyError('No se pudo copiar. Selecciona las palabras y cópialas o anótalas a mano.'); }
  }

  return <main className="auth-page page-shell" id="main-content">
    <section className="auth-card recovery-card" aria-labelledby="recovery-title">
      <span className="recovery-emblem" aria-hidden="true"><KeyRound size={24} /></span>
      <p className="eyebrow">{reason === 'recover' ? 'Contraseña actualizada' : 'Cuenta creada'}</p>
      <h1 ref={heading} id="recovery-title" tabIndex={-1}>Guarda tus palabras</h1>
      <p className="auth-description">Anota estas 8 palabras en orden junto con tu usuario <strong>{username}</strong>. Las necesitarás si olvidas tu contraseña.</p>
      <ol className="recovery-words" aria-label="Palabras de recuperación en orden">
        {phrase.split(' ').map((word, index) => <li key={index}><span aria-hidden="true">{index + 1}.</span>{word}</li>)}
      </ol>
      <button type="button" className="text-button recovery-copy" onClick={() => void copy()}>
        {copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Palabras copiadas' : 'Copiar palabras'}
      </button>
      {copyError && <ErrorNotice compact message={copyError} />}
      <p className="recovery-notice">Solo se muestran esta vez. {reason === 'recover' && 'Estas palabras reemplazan las anteriores. '}Guárdalas en un lugar privado; permiten recuperar tu cuenta.</p>
      <form onSubmit={event => { event.preventDefault(); if (saved) onContinue(); }}>
        <label className="recovery-confirmation"><input type="checkbox" required checked={saved} onChange={event => setSaved(event.target.checked)} />
          <span>Ya guardé mi usuario y las 8 palabras en orden.</span>
        </label>
        <button type="submit" className="button button-primary" disabled={!saved}><ArrowRight size={18} />Ir a mi biblioteca</button>
      </form>
    </section>
  </main>;
}
