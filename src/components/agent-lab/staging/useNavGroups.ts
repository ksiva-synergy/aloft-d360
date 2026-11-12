'use client';

import { useMemo } from 'react';
import { useSectionLevels } from '@/lib/sections/useSectionLevels';
import { NAV_GROUPS, filterNavGroups, type NavGroup } from './nav-config';

/** Sidebar groups for the signed-in person. Shows everything until their section levels load. */
export function useNavGroups(): NavGroup[] {
  const me = useSectionLevels();
  const levels = me?.levels ?? null;
  return useMemo(() => filterNavGroups(NAV_GROUPS, levels), [levels]);
}
