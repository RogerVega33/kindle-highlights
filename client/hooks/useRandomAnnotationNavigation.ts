import { useCallback, useEffect, useRef, useState } from 'react';
import { createRandomAnnotationNavigation } from '../lib/random-annotation-navigation';

export function useRandomAnnotationNavigation() {
  const [isOpen, setIsOpen] = useState(false);
  const navigation = useRef<ReturnType<typeof createRandomAnnotationNavigation> | null>(null);
  useEffect(() => {
    const controller = createRandomAnnotationNavigation(window, setIsOpen);
    navigation.current = controller;
    return () => { controller.dispose(); navigation.current = null; };
  }, []);
  const open = useCallback(() => navigation.current?.open(), []);
  const close = useCallback((afterClose?: () => void) => navigation.current?.close(afterClose), []);
  return { isOpen, open, close };
}
