import { BookOpen, KeyRound, LogOut, Moon, Sun } from 'lucide-react';
import type { User } from '../../shared/types';
import { usePopupMenu } from '../hooks/usePopupMenu';

export interface SiteHeaderProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onHome: () => void;
  user?: User;
  onLogout?: () => void;
  onChangePassword?: () => void;
  busy?: boolean;
}

export function SiteHeader({ theme, onToggleTheme, onHome, user, onLogout, onChangePassword, busy }: SiteHeaderProps) {
  const menu = usePopupMenu();
  return <header className="site-header"><div className="header-inner">
    <button type="button" className="brand" onClick={onHome} aria-label="Kindle highlights, inicio">
      <span className="brand-mark"><BookOpen size={25} strokeWidth={1.35} /></span>
      <span><span className="brand-name">Kindle highlights</span><span className="brand-tagline">TU BIBLIOTECA PERSONAL DE SUBRAYADOS Y NOTAS</span></span>
    </button>
    <div className="header-actions">
      <button type="button" className="icon-button theme-button" aria-label={theme === 'light' ? 'Activar tema oscuro' : 'Activar tema claro'} onClick={onToggleTheme}>
        {theme === 'light' ? <Moon size={19} strokeWidth={1.5} /> : <Sun size={20} strokeWidth={1.5} />}
      </button>
      {user && <><span className="header-divider" /><div className="account-menu-wrap" {...menu.rootProps}>
        <button type="button" className="account-user account-trigger" ref={menu.triggerRef} aria-label={`Menú de la cuenta de ${user.username}`} title={user.username}
          aria-haspopup="menu" aria-expanded={menu.open} aria-controls={menu.open ? menu.menuId : undefined} disabled={busy} onClick={menu.toggle}>
          <span className="user-avatar" aria-hidden="true">{user.username[0]?.toLocaleUpperCase('es')}</span>
        </button>
        {menu.open && <div className="account-menu" id={menu.menuId} role="menu" aria-label="Mi cuenta" ref={menu.menuRef}>
          <span className="account-menu-heading" aria-hidden="true">{user.username}</span>
          {onChangePassword && <button type="button" role="menuitem" tabIndex={-1} disabled={busy}
            onClick={() => { menu.close(); onChangePassword(); }}><KeyRound size={17} aria-hidden="true" />Cambiar contraseña</button>}
          {onLogout && <button type="button" role="menuitem" tabIndex={-1} disabled={busy}
            onClick={() => { menu.close(); onLogout(); }}><LogOut size={17} aria-hidden="true" />Cerrar sesión</button>}
        </div>}
      </div></>}
    </div>
  </div></header>;
}
