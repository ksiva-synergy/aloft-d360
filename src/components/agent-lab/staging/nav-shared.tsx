'use client';

import { useCallback, useEffect, useState } from 'react';
import { SidebarIcon, SquareSplitHorizontalIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

export type NavStyle = 'command' | 'rail';

const STYLE_KEY = 'aloft-nav-style';
const STYLE_EVENT = 'aloft:nav-style';

/** Which sidebar layout the user picked; persisted per browser. */
export function useNavStyle(): [NavStyle, (s: NavStyle) => void] {
  const [style, setStyleState] = useState<NavStyle>('command');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STYLE_KEY);
      if (saved === 'rail' || saved === 'command') setStyleState(saved);
    } catch { /* storage unavailable */ }
    const onChange = (e: Event) => setStyleState((e as CustomEvent<NavStyle>).detail);
    window.addEventListener(STYLE_EVENT, onChange);
    return () => window.removeEventListener(STYLE_EVENT, onChange);
  }, []);

  const setStyle = useCallback((s: NavStyle) => {
    try { localStorage.setItem(STYLE_KEY, s); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent(STYLE_EVENT, { detail: s }));
  }, []);

  return [style, setStyle];
}

/** Small button that flips between the two sidebar layouts. */
export function NavStyleToggle({ current, className }: { current: NavStyle; className?: string }) {
  const [, setStyle] = useNavStyle();
  const next: NavStyle = current === 'command' ? 'rail' : 'command';
  const Icon = next === 'rail' ? SquareSplitHorizontalIcon : SidebarIcon;
  return (
    <button
      onClick={() => setStyle(next)}
      aria-label={next === 'rail' ? 'Switch to rail sidebar' : 'Switch to command sidebar'}
      title={next === 'rail' ? 'Switch to rail sidebar' : 'Switch to command sidebar'}
      className={cn('flex shrink-0 items-center justify-center rounded-full transition-colors', className)}
    >
      <Icon size={16} />
    </button>
  );
}

/** Soft blurred violet/cyan light blobs behind the dark sidebar surfaces. */
export function AuroraGlow({ className }: { className?: string }) {
  return (
    <span aria-hidden style={{ opacity: 'var(--rail-glow, 1)' }} className={cn('pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]', className)}>
      <span className="absolute -left-16 -top-16 h-48 w-48 rounded-full bg-[var(--brand-a)] opacity-25 blur-[56px]" />
      <span className="absolute -bottom-16 -right-16 h-40 w-40 rounded-full bg-[var(--rail-accent)] opacity-10 blur-[56px]" />
    </span>
  );
}
