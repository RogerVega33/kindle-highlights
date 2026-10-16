import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CircleAlert, LoaderCircle, Trash2 } from 'lucide-react';
import { messageOf } from '../lib/format';
import { Modal } from './Modal';

export function ConfirmationDialog({ title, description, children, onConfirm, onClose, onCompleted, className, actionLabel = 'Eliminar', pendingLabel = actionLabel }: {
  title: string;
  description: string;
  children?: ReactNode;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  onCompleted?: () => void;
  className?: string;
  actionLabel?: string;
  pendingLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onCompleted?.();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal title={title} description={description} className={className} onClose={() => { if (!inFlight.current) onClose(); }}>
      {children}
      {error && <div className="inline-error" role="alert"><CircleAlert size={18} /><span>{error}</span></div>}
      <div className="modal-footer">
        <button type="button" className="button button-quiet" disabled={busy} onClick={onClose}>Cancelar</button>
        <button type="button" className="button button-danger" disabled={busy} aria-busy={busy} onClick={() => void confirm()}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}{busy ? pendingLabel : actionLabel}
        </button>
      </div>
    </Modal>
  );
}
