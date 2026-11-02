'use client';

import { useEffect, type RefObject } from 'react';

export function useUserDialogFocus(open: boolean, ref: RefObject<HTMLElement>) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const selector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]';
    const frame = requestAnimationFrame(() => {
      ref.current?.querySelector<HTMLElement>(selector)?.focus();
    });
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.key !== 'Tab' || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(selector))
        .filter((element) => element.tabIndex >= 0 && element.getAttribute('aria-hidden') !== 'true');
      const first = items[0];
      const last = items[items.length - 1];
      if (!first) { event.preventDefault(); ref.current.focus(); return; }
      if (!ref.current.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [open, ref]);
}
