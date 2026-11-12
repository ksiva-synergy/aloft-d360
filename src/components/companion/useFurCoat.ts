'use client';

import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { cachedCoat, coatKey, coatScale, loadCoat, resolveRgb, type Coat, type CoatShape } from './wobble-fur';

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** The painted fur images for this companion; null until they are ready (server render, first paint, no canvas). */
export function useFurCoat(root: RefObject<HTMLSpanElement>, coatShape: CoatShape, size: number, color: string, variable = '--wob') {
  const [coat, setCoat] = useState<Coat | null>(null);
  useBrowserLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const scale = coatScale(size);
    let wanted = '';
    const sync = () => {
      const rgb = resolveRgb(getComputedStyle(el).getPropertyValue(variable));
      const key = coatKey(coatShape, rgb, scale);
      if (key === wanted) return;
      wanted = key;
      const ready = cachedCoat(key);
      if (ready) { setCoat(ready); return; }
      void loadCoat(coatShape, rgb, scale).then(painted => { if (painted && wanted === key) setCoat(painted); });
    };
    sync();
    // Accent and light/dark changes restyle <html>; repaint when that changes this companion's colour.
    const watch = new MutationObserver(sync);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
    return () => { wanted = ''; watch.disconnect(); };
  }, [root, coatShape, size, color, variable]);
  return coat;
}

