'use client';

import { useEffect, useRef, useState } from 'react';

/** True only while `active`, on screen, and the tab is in the foreground. */
export function useAnimateWhenVisible<T extends Element>(active: boolean) {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(true);
  const [foreground, setForeground] = useState(true);
  useEffect(() => {
    if (!active) return;
    const sync = () => setForeground(!document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    const observer = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting)) : null;
    if (ref.current) observer?.observe(ref.current);
    return () => { observer?.disconnect(); document.removeEventListener('visibilitychange', sync); };
  }, [active]);
  return [ref, active && visible && foreground] as const;
}
