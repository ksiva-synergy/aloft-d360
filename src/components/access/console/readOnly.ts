'use client';

import { createContext, useContext } from 'react';

/**
 * True when the viewer has View (not Manage) on Govern → Data access. Views hide or disable their
 * edit controls; the APIs refuse changes either way. Defaults to false so embedded editors (the
 * Users drawer) keep their own rules.
 */
export const ConsoleReadOnlyContext = createContext(false);

export function useConsoleReadOnly(): boolean {
  return useContext(ConsoleReadOnlyContext);
}
