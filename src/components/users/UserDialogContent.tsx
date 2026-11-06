'use client';

import { useRef, type ReactNode } from 'react';
import { DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useUserDialogFocus } from './useUserDialogFocus';
import styles from './users.module.css';

export function UserDialogContent({ open, labelledBy, describedBy, children }: {
  open: boolean;
  labelledBy: string;
  describedBy?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useUserDialogFocus(open, ref);
  return (
    <DialogContent className={cn(styles.surface, styles.invite)}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-describedby={describedBy} tabIndex={-1}>
        {children}
      </div>
    </DialogContent>
  );
}
