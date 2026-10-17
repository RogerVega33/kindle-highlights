import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import { Eye, EyeOff, LoaderCircle } from 'lucide-react';
import type { Credentials, RecoveryCredentials } from '../../../shared/types';
import { RecoverAccountView } from './RecoverAccountView';
import { ErrorNotice } from '../../components/ErrorNotice';
import { HelpLabel } from './HelpLabel';
import { MAX_PASSWORD_LENGTH, MAX_USERNAME_LENGTH, MIN_PASSWORD_LENGTH, MIN_USERNAME_LENGTH } from '../../../shared/limits';
import type { AuthScreen } from '../../lib/auth-navigation';

interface AuthViewProps {
  action: AuthScreen; onNavigate: (screen: AuthScreen) => void;
  busy: boolean; error: string; onSubmit: (action: 'login' | 'register', credentials: Credentials) => Promise<void>;
  onRecover: (credentials: RecoveryCredentials) => Promise<void>; onClearError: () => void;
}

export function AuthView(props: AuthViewProps) {
  const [username, setUsername] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [props.action]);

  return props.action === 'recover'
    ? <RecoverAccountView busy={props.busy} error={props.error} username={username} onSubmit={props.onRecover} onBack={() => props.onNavigate('login')} headingRef={heading} />
    : <CredentialsForm key={props.action} {...props} action={props.action} username={username} onUsernameChange={setUsername} headingRef={heading} />;
}

function CredentialsForm({ action, busy, error, onSubmit, onNavigate, onClearError, username, onUsernameChange, headingRef }: AuthViewProps & {
  action: 'login' | 'register'; username: string; onUsernameChange: (value: string) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [localError, setLocalError] = useState('');
  const usernameId = useId();
  const passwordId = useId();
  const confirmationId = useId();
  const errorId = useId();
  const passwordRef = useRef<HTMLInputElement>(null);
  const registering = action === 'register';

  function changeAction(next: AuthScreen) {
    onClearError();
    onNavigate(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (registering && password !== confirmation) { setLocalError('Las contraseñas no coinciden.'); passwordRef.current?.focus(); return; }
    setLocalError('');
    await onSubmit(action, { username, password });
  }

  return <main className="auth-page page-shell" id="main-content">
    <section className="auth-card" aria-labelledby="auth-title">
      <h1 ref={headingRef} id="auth-title" tabIndex={-1}>{registering ? 'Crear cuenta' : 'Iniciar sesión'}</h1>
      {registering && <p className="auth-description">Sin correo ni teléfono. Al crear tu cuenta recibirás 8 palabras para recuperar el acceso.</p>}
      <form onSubmit={event => void submit(event)} aria-busy={busy}>
        <div className="auth-password-field">
          {registering ? <HelpLabel htmlFor={usernameId} label="Usuario" hint="De 3 a 50 caracteres. Usa letras sin acentos, números o @ . - _. Sin espacios." /> : <label htmlFor={usernameId}>Usuario</label>}
        <input id={usernameId} name="username" autoComplete="username" required minLength={MIN_USERNAME_LENGTH} maxLength={MAX_USERNAME_LENGTH}
          pattern="[a-zA-Z0-9@._\-]+" value={username} disabled={busy} onChange={event => onUsernameChange(event.target.value)} />
        </div>
        <div className="auth-password-field">
          {registering ? <HelpLabel htmlFor={passwordId} label="Contraseña" hint="Entre 12 y 128 caracteres." /> : <label htmlFor={passwordId}>Contraseña</label>}
        <div className="auth-password-input"><input id={passwordId} ref={passwordRef} name="password" type={showPassword ? 'text' : 'password'} autoComplete={registering ? 'new-password' : 'current-password'} required
          minLength={registering ? MIN_PASSWORD_LENGTH : 1} maxLength={MAX_PASSWORD_LENGTH} value={password} disabled={busy}
          onChange={event => { setPassword(event.target.value); setLocalError(''); }} />
          <button type="button" className="auth-password-toggle" disabled={busy} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-controls={passwordId} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button>
        </div>
        </div>
        {registering && <>
          <div className="auth-password-field"><label htmlFor={confirmationId}>Confirmar contraseña</label><div className="auth-password-input"><input id={confirmationId} name="confirmation" type={showConfirmation ? 'text' : 'password'} autoComplete="new-password" required maxLength={MAX_PASSWORD_LENGTH}
            disabled={busy} value={confirmation} onChange={event => { setConfirmation(event.target.value); setLocalError(''); }} />
            <button type="button" className="auth-password-toggle" disabled={busy} aria-label={showConfirmation ? 'Ocultar confirmación de contraseña' : 'Mostrar confirmación de contraseña'} aria-controls={confirmationId} onClick={() => setShowConfirmation(value => !value)}>{showConfirmation ? <EyeOff size={20} /> : <Eye size={20} />}</button>
          </div></div></>}
        {(localError || error) && <ErrorNotice compact id={errorId} message={localError || error} />}
        <button type="submit" className="button button-primary" disabled={busy}>{busy && <LoaderCircle size={18} className="spin" />}{registering ? 'Crear cuenta' : 'Iniciar sesión'}</button>
      </form>
      {!registering && <p className="auth-recover-link"><button type="button" className="text-button" disabled={busy}
        onClick={() => changeAction('recover')}>¿Olvidaste tu contraseña?</button></p>}
      <p className="auth-switch">{registering ? '¿Ya tienes una cuenta?' : '¿Primera vez aquí?'} <button type="button" className="text-button" disabled={busy} onClick={() => {
        changeAction(registering ? 'login' : 'register');
      }}>{registering ? 'Inicia sesión' : 'Crea tu cuenta'}</button></p>
    </section>
  </main>;
}
