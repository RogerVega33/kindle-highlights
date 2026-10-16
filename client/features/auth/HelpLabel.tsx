import { useId, useState } from 'react';
import { CircleHelp } from 'lucide-react';

export function HelpLabel({ htmlFor, label, hint, hintId }: { htmlFor: string; label: string; hint: string; hintId?: string }) {
  const generatedHintId = useId();
  const descriptionId = hintId ?? generatedHintId;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const visible = (hovered || focused) && !dismissed;

  return <div className="auth-field-label" onMouseLeave={() => setHovered(false)}>
    <label htmlFor={htmlFor}>{label}</label>
    <button type="button" className="auth-help-toggle" aria-label={`Requisitos de ${label.toLowerCase()}`} aria-describedby={descriptionId}
      onMouseEnter={() => { setHovered(true); setDismissed(false); }}
      onFocus={() => { setFocused(true); setDismissed(false); }} onBlur={() => setFocused(false)}
      onKeyDown={event => { if (event.key === 'Escape' && visible) { event.preventDefault(); event.stopPropagation(); setDismissed(true); } }}>
      <CircleHelp size={16} aria-hidden="true" />
    </button>
    <span id={descriptionId} role="tooltip" className="auth-help-tooltip" hidden={!visible}>{hint}</span>
  </div>;
}
