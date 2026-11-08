'use client';

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import userStyles from '@/components/users/users.module.css';
import s from './console.module.css';

/**
 * Inline "why?" step for any change: every column access change needs a reason (min 5 characters),
 * which goes to the audit log.
 */
export function ReasonConfirm({
  prompt,
  confirmLabel = 'Save',
  placeholder = 'Reason (required)',
  danger,
  onConfirm,
  onCancel,
  children,
}: {
  prompt: ReactNode;
  confirmLabel?: string;
  placeholder?: string;
  danger?: boolean;
  onConfirm: (reason: string) => Promise<void>;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = reason.trim().length >= 5;

  async function confirm() {
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
      setBusy(false);
    }
  }

  return (
    <div className={s.inlineForm}>
      <div className="text-size-ui">{prompt}</div>
      {children}
      <Input
        className={userStyles.input}
        value={reason}
        autoFocus
        onChange={(e) => setReason(e.target.value)}
        placeholder={placeholder}
        aria-label="Reason for this change"
        onKeyDown={(e) => {
          if (e.key === 'Enter') void confirm();
          if (e.key === 'Escape') onCancel();
        }}
      />
      {error ? (
        <p className={s.errorText} role="alert">
          {error}
        </p>
      ) : null}
      <div className={s.rowActions}>
        <Button
          type="button"
          className={cn(userStyles.primary, danger && 'bg-[var(--bad)] hover:bg-[var(--bad)]')}
          disabled={!ok || busy}
          onClick={() => void confirm()}
        >
          {busy ? 'Saving…' : confirmLabel}
        </Button>
        <Button type="button" variant="outline" className={userStyles.secondaryButton} onClick={onCancel}>
          Cancel
        </Button>
        {!ok && reason.length > 0 ? (
          <span className="text-caption text-muted-foreground">At least 5 characters</span>
        ) : null}
      </div>
    </div>
  );
}
