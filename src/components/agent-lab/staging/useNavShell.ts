'use client';

import { usePathname } from '@/lib/navigation';
import { useCallback, useEffect, useRef, useState, type FocusEvent } from 'react';

const PIN_KEY = 'aloft-nav-pinned';
export const TOGGLE_EVENT = 'aloft:nav-toggle';

/**
 * Shared open/close behaviour for both sidebar styles: auto-collapse on hover-out
 * (unless pinned), "[" toggles the pin, the header's menu button opens the mobile
 * drawer, and Escape closes it.
 */
export function useNavShell() {
  const pathname = usePathname();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shellRef = useRef<HTMLElement>(null);

  // Restore the pin preference after hydration (server renders the auto-hide default).
  useEffect(() => {
    try {
      if (localStorage.getItem(PIN_KEY) === '1') setPinned(true);
    } catch { /* storage unavailable */ }
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onToggle = () => setMobileOpen((o) => !o);
    window.addEventListener(TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(TOGGLE_EVENT, onToggle);
  }, []);

  const togglePin = useCallback(() => {
    setPinned((p) => {
      const next = !p;
      try { localStorage.setItem(PIN_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === '[' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) togglePin();
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePin]);

  const open = useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setHovered(true);
  }, []);

  // The page reflows when the sidebar expands, so a mouse just passing over it
  // shouldn't trigger that: wait for a brief hover first.
  const openSoon = useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setHovered(true), 140);
  }, []);

  const close = useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => {
      // Keep the panel open while a text box inside it has focus.
      const a = document.activeElement as HTMLElement | null;
      if (a && shellRef.current?.contains(a) && a.tagName === 'INPUT') return;
      setHovered(false);
    }, 280);
  }, []);

  /** Spread onto the sidebar's root element. */
  const hoverProps = {
    ref: shellRef,
    onMouseEnter: openSoon,
    onMouseLeave: close,
    onFocusCapture: open,
    onBlurCapture: (e: FocusEvent) => {
      if (!shellRef.current?.contains(e.relatedTarget as Node)) close();
    },
  };

  return {
    pinned,
    togglePin,
    mobileOpen,
    setMobileOpen,
    expanded: pinned || hovered || mobileOpen,
    open,
    close,
    setHovered,
    hoverProps,
  };
}
