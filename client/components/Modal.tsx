import { useEffect, useId, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { X } from 'lucide-react';

export function Modal({ title, description, children, onClose, className = '', initialFocusRef, returnFocusFallbackRef, closeOnBackdropClick = true, closeOnEscape = true }: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusFallbackRef?: RefObject<HTMLElement | null>;
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const container = useRef<HTMLDivElement>(null);
  const dismiss = useRef({ onClose, closeOnEscape });
  dismiss.current = { onClose, closeOnEscape };
  useEffect(() => {
    const before = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (initialFocusRef?.current || container.current)?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (dismiss.current.closeOnEscape) dismiss.current.onClose();
      }
      if (event.key !== 'Tab' || !container.current) return;
      const focusable = Array.from(container.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]',
      )).filter(element => element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === container.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === container.current)) {
        event.preventDefault();
        first.focus();
      }
    };
    const keepFocusInside = (event: FocusEvent) => {
      if (container.current && event.target instanceof Node && !container.current.contains(event.target)) {
        container.current.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('focusin', keepFocusInside);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('focusin', keepFocusInside);
      if (before instanceof HTMLElement && before.isConnected) before.focus();
      else returnFocusFallbackRef?.current?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={event => { if (closeOnBackdropClick && event.target === event.currentTarget) onClose(); }}>
      <div ref={container} className={'modal ' + className} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} tabIndex={-1}>
        <div className="modal-heading">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button type="button" className="icon-button modal-close" aria-label="Cerrar" onClick={onClose}><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
