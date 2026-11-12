'use client';

import { usePathname } from '@/lib/navigation';
import { useCallback, useEffect, useRef, useState, type FocusEvent } from 'react';

const PIN_KEY = 'aloft-nav-pinned';
export const TOGGLE_EVENT = 'aloft:nav-toggle';

function memberPinDefaultRole(role: string | null | undefined): boolean {
  return role === 'member' || role === 'readonly';
}

function readStoredPin(): boolean | null {
  try {
    const stored = localStorage.getItem(PIN_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch { /* storage unavailable */ }
  return null;
}

export type NavShellOptions = {
  /** Role from the server session so the first client paint can pin for members before useSession resolves. */
  initialRole?: string | null;
};

/**
 * Shared open/close behaviour for both sidebar styles: auto-collapse on hover-out
 * (unless pinned), "[" toggles the pin, the header's menu button opens the mobile
 * drawer, and Escape closes it.
 */
export function useNavShell(options: NavShellOptions = {}) {
  const pathname = usePathname();
  const [pinned, setPinned] = useState(() => {
    if (typeof window === 'undefined') return memberPinDefaultRole(options.initialRole);
    const stored = readStoredPin();
    if (stored !== null) return stored;
    return memberPinDefaultRole(options.initialRole);
  });
  const [hovered, setHovered] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shellRef = useRef<HTMLElement>(null);

  // Restore pin preference (or member default) after hydration when role/session was not ready at init.
  useEffect(() => {
    try {
      const stored = readStoredPin();
      if (stored === true) {
        setPinned(true);
        return;
      }
      if (stored === false) return;
      if (memberPinDefaultRole(options.initialRole)) {
        setPinned(true);
        localStorage.setItem(PIN_KEY, '1');
      }
    } catch { /* storage unavailable */ }
  }, [options.initialRole]);

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
