import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import type { RecoveryCredentials } from '../../../shared/types';
import { HelpLabel } from './HelpLabel';
import { ErrorNotice } from '../../components/ErrorNotice';
import { MAX_PASSWORD_LENGTH, MAX_RECOVERY_PHRASE_LENGTH, MAX_USERNAME_LENGTH, MIN_PASSWORD_LENGTH, MIN_USERNAME_LENGTH, RECOVERY_WORD_COUNT } from '../../../shared/limits';

export function RecoverAccountView({ busy, error, username: initialUsername, onSubmit, onBack }: {
  busy: boolean; error: string; username: string; onSubmit: (credentials: RecoveryCredentials) => Promise<void>; onBack: () => void;
}) {
  const [username, setUsername] = useState(initialUsername);
  const [recoveryPhrase, setRecoveryPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPhrase, setShowPhrase] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [localError, setLocalError] = useState('');
  const id = useId();
  const phraseRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (recoveryPhrase.trim().split(/[\s-]+/u).length !== RECOVERY_WORD_COUNT) {
      setLocalError(`Escribe las ${RECOVERY_WORD_COUNT} palabras en el orden en que las guardaste.`);
      phraseRef.current?.focus(); return;
    }
    if (password !== confirmation) {
      setLocalError('Las contraseñas no coinciden.'); confirmationRef.current?.focus(); return;
    }
    setLocalError('');
    await onSubmit({ username, recoveryPhrase, password });
  }

  return <main className="auth-page page-shell" id="main-content">
    <section className="auth-card" aria-labelledby={`${id}-title`}>
      <h1 id={`${id}-title`}>Recuperar cuenta</h1>
      <p className="auth-description">Usa las palabras que guardaste al crear tu cuenta para elegir una contraseña nueva.</p>
      <form onSubmit={event => void submit(event)} aria-busy={busy}>
        <label htmlFor={`${id}-username`}>Usuario
          <input id={`${id}-username`} name="username" autoComplete="username" required minLength={MIN_USERNAME_LENGTH}
            maxLength={MAX_USERNAME_LENGTH} pattern="[a-zA-Z0-9@._\-]+" value={username} disabled={busy}
            onChange={event => setUsername(event.target.value)} />
        </label>
        <div className="auth-password-field">
          <HelpLabel htmlFor={`${id}-phrase`} label="Palabras de recuperación" hintId={`${id}-help`}
            hint="Las 8 palabras en orden, sin números, separadas por espacios o guiones. No importan las mayúsculas." />
          <div className="auth-password-input">
            <input id={`${id}-phrase`} ref={phraseRef} name="recoveryPhrase" type={showPhrase ? 'text' : 'password'}
              autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} required
              maxLength={MAX_RECOVERY_PHRASE_LENGTH} disabled={busy} value={recoveryPhrase} aria-describedby={`${id}-help`}
              onChange={event => { setRecoveryPhrase(event.target.value); setLocalError(''); }} />
            <button type="button" className="auth-password-toggle" disabled={busy} aria-controls={`${id}-phrase`}
              aria-label={showPhrase ? 'Ocultar palabras' : 'Mostrar palabras'} onClick={() => setShowPhrase(value => !value)}>
              {showPhrase ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
        </div>
        <div className="auth-password-field">
          <HelpLabel htmlFor={`${id}-password`} label="Nueva contraseña" hintId={`${id}-password-help`} hint="Entre 12 y 128 caracteres." />
          <div className="auth-password-input">
            <input id={`${id}-password`} name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required
              minLength={MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH} disabled={busy} value={password}
              aria-describedby={`${id}-password-help`} onChange={event => { setPassword(event.target.value); setLocalError(''); }} />
            <button type="button" className="auth-password-toggle" disabled={busy} aria-controls={`${id}-password`}
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShowPassword(value => !value)}>
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
        </div>
        <div className="auth-password-field">
          <label htmlFor={`${id}-confirmation`}>Confirmar nueva contraseña</label>
          <div className="auth-password-input">
            <input id={`${id}-confirmation`} ref={confirmationRef} name="confirmation" type={showConfirmation ? 'text' : 'password'} autoComplete="new-password" required
              maxLength={MAX_PASSWORD_LENGTH} disabled={busy} value={confirmation}
              onChange={event => { setConfirmation(event.target.value); setLocalError(''); }} />
            <button type="button" className="auth-password-toggle" disabled={busy} aria-controls={`${id}-confirmation`}
              aria-label={showConfirmation ? 'Ocultar confirmación de contraseña' : 'Mostrar confirmación de contraseña'} onClick={() => setShowConfirmation(value => !value)}>
              {showConfirmation ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
        </div>
        {(localError || error) && <ErrorNotice compact message={localError || error} />}
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? <LoaderCircle size={18} className="spin" /> : <ArrowRight size={18} />}Cambiar contraseña
        </button>
      </form>
      <p className="auth-switch"><button type="button" className="text-button" disabled={busy} onClick={onBack}><ArrowLeft size={15} /> Volver a iniciar sesión</button></p>
    </section>
  </main>;
}
