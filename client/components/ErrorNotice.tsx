import { CircleAlert } from 'lucide-react';

export function ErrorNotice({ message, title, action, compact = false, className = '', id }: {
  message: string; title?: string; compact?: boolean; className?: string; id?: string;
  action?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return <div id={id} role="alert" className={'error-notice' + (compact ? ' error-notice--compact' : ' page-error') + (action ? ' error-notice--action' : '') + (className ? ' ' + className : '')}>
    <CircleAlert size={20} className="error-notice-icon" aria-hidden="true" />
    <div className="error-notice-body">{title && <strong>{title}</strong>}<p>{message}</p></div>
    {action && <button type="button" className="button button-primary error-notice-action" disabled={action.disabled} onClick={action.onClick}>{action.label}</button>}
  </div>;
}
