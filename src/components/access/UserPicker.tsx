'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import userStyles from '@/components/users/users.module.css';

export type AccessUserOption = {
  id: string;
  email: string;
  name: string | null;
  status?: string;
};

type UserPickerProps = {
  label: string;
  value: string;
  onChange: (userId: string) => void;
  users: AccessUserOption[];
  placeholder?: string;
  excludeUserIds?: string[];
  disabled?: boolean;
  className?: string;
};

function displayUser(u: AccessUserOption) {
  const name = u.name?.trim();
  return name ? `${name} · ${u.email}` : u.email;
}

export function UserPicker({
  label,
  value,
  onChange,
  users,
  placeholder = 'Select a person…',
  excludeUserIds,
  disabled,
  className,
}: UserPickerProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number; width: number } | null>(null);

  const selected = users.find((u) => u.id === value);
  const exclude = useMemo(() => new Set(excludeUserIds ?? []), [excludeUserIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (exclude.has(u.id)) return false;
      if (!q) return true;
      const hay = `${u.name ?? ''} ${u.email}`.toLowerCase();
      return hay.includes(q);
    });
  }, [users, query, exclude]);

  useEffect(() => {
    if (!open || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    setMenuStyle({
      top: rect.bottom + 8,
      left: rect.left,
      width: Math.max(rect.width, 280),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        className={cn(
          userStyles.selectTrigger,
          'w-full justify-between text-left',
          !selected && 'text-muted-foreground',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
          setQuery('');
        }}
      >
        <span className="truncate">{selected ? displayUser(selected) : placeholder}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
      </button>

      {open && menuStyle ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[90] cursor-default bg-transparent"
            aria-label="Close user list"
            onClick={() => setOpen(false)}
          />
          <div
            role="listbox"
            id={listId}
            className={cn(
              userStyles.surface,
              userStyles.selectMenu,
              'fixed z-[100] flex max-h-[min(320px,50vh)] flex-col overflow-hidden p-2 shadow-lg',
            )}
            style={{ top: menuStyle.top, left: menuStyle.left, width: menuStyle.width }}
          >
            <div className="relative mb-2 shrink-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or email…"
                className={cn(userStyles.input, '!pl-9')}
                aria-controls={listId}
              />
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <li className="px-2 py-3 text-center text-size-ui text-muted-foreground">No people match</li>
              ) : (
                filtered.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={u.id === value}
                      className={cn(
                        userStyles.selectItem,
                        'w-full text-left !pl-3',
                        u.id === value && 'font-medium',
                      )}
                      onClick={() => {
                        onChange(u.id);
                        setOpen(false);
                      }}
                    >
                      <span className="block truncate">{displayUser(u)}</span>
                      {u.status && u.status !== 'ACTIVE' ? (
                        <span className="text-caption text-muted-foreground">{u.status}</span>
                      ) : null}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function userLabel(users: AccessUserOption[], userId: string | undefined): string {
  if (!userId) return '—';
  const u = users.find((x) => x.id === userId);
  if (!u) return `${userId.slice(0, 8)}…`;
  return u.name?.trim() || u.email;
}
