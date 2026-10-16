import { useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';

/** Shared focus and dismissal behavior for account, action and sort menus. */
export function usePopupMenu(initialFocus: 'first' | 'selected' = 'first') {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<'first' | 'last' | 'selected'>(initialFocus);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    const selected = menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)');
    const target = focusOnOpen.current === 'last' ? items?.[items.length - 1]
      : focusOnOpen.current === 'selected' ? selected ?? items?.[0] : items?.[0];
    target?.focus();
    function outside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (!open) {
      focusOnOpen.current = event.key === 'ArrowUp' || event.key === 'End' ? 'last'
        : event.key === 'Home' ? 'first' : initialFocus;
      setOpen(true);
      return;
    }
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }

  function toggle() {
    focusOnOpen.current = initialFocus;
    setOpen(previous => !previous);
  }

  return { open, triggerRef, menuRef, menuId, close, toggle, rootProps: { ref: rootRef, onKeyDown, onBlur } };
}
