'use client';

import type { ComponentProps } from 'react';
import { useCompanionPreferences } from '@/hooks/useCompanionPreferences';
import { Captain } from './Captain';
import { Mochi } from './Mochi';
import { Wobble } from './Wobble';

/** Renders whichever companion character the user picked in settings. */
export function Companion(props: ComponentProps<typeof Wobble>) {
  const saved = useCompanionPreferences();
  const preferences = props.preferences ?? saved;
  if (preferences.character === 'captain') return <Captain {...props} />;
  if (preferences.character === 'mochi') return <Mochi {...props} />;
  return <Wobble {...props} shape={preferences.character} />;
}
