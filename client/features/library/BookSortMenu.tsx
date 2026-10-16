import { Check, ChevronDown } from 'lucide-react';
import type { BookSort } from '../../../shared/types';
import { usePopupMenu } from '../../hooks/usePopupMenu';

const options: { value: BookSort; label: string }[] = [
  { value: 'recent', label: 'Más recientes' },
  { value: 'title', label: 'Por título' },
  { value: 'author', label: 'Por autor' },
];

export function BookSortMenu({ value, onChange }: { value: BookSort; onChange: (value: BookSort) => void }) {
  const menu = usePopupMenu('selected');
  const selected = options.find(option => option.value === value) ?? options[0];

  return <div className="sort-control" {...menu.rootProps}>
    <button type="button" className="sort-trigger" ref={menu.triggerRef} aria-label={'Ordenar libros: ' + selected.label}
      aria-haspopup="menu" aria-expanded={menu.open} aria-controls={menu.open ? menu.menuId : undefined} onClick={menu.toggle}>
      {selected.label}<ChevronDown size={16} aria-hidden="true" />
    </button>
    {menu.open && <div className="sort-menu" id={menu.menuId} role="menu" aria-label="Ordenar libros" ref={menu.menuRef}>
      <span className="sort-menu-heading" aria-hidden="true">Ordenar por</span>
      {options.map(option => <button type="button" key={option.value} role="menuitemradio" aria-checked={value === option.value}
        tabIndex={-1} onClick={() => {
          onChange(option.value);
          menu.close();
        }}>{option.label}<Check size={16} aria-hidden="true" /></button>)}
    </div>}
  </div>;
}
