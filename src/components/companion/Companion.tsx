'use client';

import type { ComponentProps } from 'react';
import { useCompanionPreferences } from '@/hooks/useCompanionPreferences';
import { Captain } from './Captain';
import { Wobble } from './Wobble';

/** Renders whichever companion character the user picked in settings. */
export function Companion(props: ComponentProps<typeof Wobble>) {
  const saved = useCompanionPreferences();
  const preferences = props.preferences ?? saved;
  return preferences.character === 'captain' ? <Captain {...props} /> : <Wobble {...props} shape={preferences.character} />;
}
