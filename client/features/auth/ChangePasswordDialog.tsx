import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Check, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import type { PasswordChangeInput } from '../../../shared/types';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../../../shared/limits';
import { Modal } from '../../components/Modal';
import { ErrorNotice } from '../../components/ErrorNotice';
import { messageOf } from '../../lib/format';
import { HelpLabel } from './HelpLabel';

const fields = [
  { name: 'currentPassword', label: 'Contraseña actual', visibilityLabel: 'contraseña actual' },
  { name: 'newPassword', label: 'Nueva contraseña', visibilityLabel: 'nueva contraseña' },
  { name: 'confirmation', label: 'Confirmar nueva contraseña', visibilityLabel: 'confirmación de contraseña' },
] as const;

export function ChangePasswordDialog({ onSave, onClose, onSaved }: {
  onSave: (input: PasswordChangeInput) => Promise<void>; onClose: () => void; onSaved: () => void;
}) {
  const [values, setValues] = useState({ currentPassword: '', newPassword: '', confirmation: '' });
  const [visible, setVisible] = useState({ currentPassword: false, newPassword: false, confirmation: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const currentRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const id = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    if (values.newPassword !== values.confirmation) {
      setError('Las contraseñas no coinciden.'); confirmationRef.current?.focus(); return;
    }
    if (values.currentPassword === values.newPassword) {
      setError('La nueva contraseña debe ser diferente de la actual.'); return;
    }
    inFlight.current = true;
    setBusy(true); setError('');
    try {
      await onSave({ currentPassword: values.currentPassword, newPassword: values.newPassword });
      onSaved();
    } catch (cause) { setError(messageOf(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <Modal title="Cambiar contraseña" description="Tu sesión actual seguirá abierta. Las demás sesiones se cerrarán."
    className="password-change-dialog" initialFocusRef={currentRef} closeOnBackdropClick={false} closeOnEscape={false}
    onClose={() => { if (!inFlight.current) onClose(); }}>
    <form className="password-change-form" onSubmit={event => void submit(event)} aria-busy={busy} aria-describedby={error ? `${id}-error` : undefined}>
      {fields.map(field => <div className="auth-password-field" key={field.name}>
        {field.name === 'newPassword'
          ? <HelpLabel htmlFor={`${id}-${field.name}`} label={field.label} hintId={`${id}-hint`} hint="Entre 12 y 128 caracteres." />
          : <label htmlFor={`${id}-${field.name}`}>{field.label}</label>}
        <div className="auth-password-input">
          <input id={`${id}-${field.name}`} name={field.name} type={visible[field.name] ? 'text' : 'password'}
            ref={field.name === 'currentPassword' ? currentRef : field.name === 'confirmation' ? confirmationRef : undefined}
            autoComplete={field.name === 'currentPassword' ? 'current-password' : 'new-password'}
            minLength={field.name === 'currentPassword' ? 1 : MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH}
            required disabled={busy} value={values[field.name]} aria-describedby={field.name === 'newPassword' ? `${id}-hint` : undefined}
            onChange={event => { const value = event.target.value; setValues(previous => ({ ...previous, [field.name]: value })); setError(''); }} />
          <button type="button" className="auth-password-toggle" disabled={busy} aria-controls={`${id}-${field.name}`}
            aria-label={`${visible[field.name] ? 'Ocultar' : 'Mostrar'} ${field.visibilityLabel}`}
            onClick={() => setVisible(previous => ({ ...previous, [field.name]: !previous[field.name] }))}>
            {visible[field.name] ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        </div>
      </div>)}
      {error && <ErrorNotice compact id={`${id}-error`} message={error} />}
      <div className="modal-footer">
        <button type="button" className="button button-quiet" disabled={busy} onClick={onClose}>Cancelar</button>
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}{busy ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  </Modal>;
}
