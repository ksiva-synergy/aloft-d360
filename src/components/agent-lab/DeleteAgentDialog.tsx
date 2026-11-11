'use client';

import { AgentAvatar } from '@/components/agent-lab/AgentAvatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Trash2 } from 'lucide-react';

type DeleteAgentDialogProps = {
  open: boolean;
  name: string;
  description?: string | null;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function DeleteAgentDialog({
  open,
  name,
  description,
  busy,
  onClose,
  onConfirm,
}: DeleteAgentDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-[min(100%,20.5rem)] p-5">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ink-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink-1)] disabled:opacity-50"
          aria-label="Close"
        >
          <span className="text-lg leading-none">×</span>
        </button>

        <div className="flex items-start gap-3 pr-6">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/12 text-red-600 dark:text-red-400"
            aria-hidden
          >
            <Trash2 className="h-4 w-4" />
          </div>
          <DialogHeader className="mb-0 min-w-0 text-left">
            <DialogTitle className="text-[length:var(--type-body-size)] font-semibold leading-tight">
              Delete this agent?
            </DialogTitle>
            <DialogDescription className="mt-1 text-[length:var(--type-ui-regular-size)] text-[var(--ink-3)]">
              This removes the agent from the catalog. You cannot undo this action.
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-[var(--line-1)] bg-[var(--surface-2)]/40 px-3 py-2.5">
          <AgentAvatar name={name} hint={description ?? ''} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-[length:var(--type-ui-regular-size)] font-semibold text-[var(--ink-1)]">
              {name}
            </p>
            {description ? (
              <p className="mt-0.5 line-clamp-2 text-[length:var(--type-caption-size)] leading-snug text-[var(--ink-3)]">
                {description}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter className="mt-5 gap-2 sm:justify-stretch">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="flex-1 gap-1.5"
            onClick={onConfirm}
            disabled={busy}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            {busy ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
