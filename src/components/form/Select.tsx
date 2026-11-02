'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Drop-in replacement for the native <select>: same props and <option>/<optgroup>
 * children, but renders the themed dropdown menu instead of the OS popup.
 */

type Opt = { value: string; label: string; node: React.ReactNode; disabled: boolean; group?: string };

function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children);
  return '';
}

function collect(children: React.ReactNode, group: string | undefined, out: Opt[]) {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as {
      value?: string | number;
      label?: string;
      disabled?: boolean;
      children?: React.ReactNode;
    };
    if (child.type === 'option') {
      const label = textOf(props.children);
      out.push({
        value: props.value !== undefined ? String(props.value) : label,
        label,
        node: props.children,
        disabled: !!props.disabled,
        group,
      });
    } else if (child.type === 'optgroup') {
      collect(props.children, props.label ?? '', out);
    } else if (child.type === React.Fragment) {
      collect(props.children, group, out);
    }
  });
}

export type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'multiple' | 'size'>;

export function Select({
  value,
  defaultValue,
  onChange,
  disabled,
  className,
  style,
  id,
  name,
  children,
  title,
  autoFocus,
  ...aria
}: SelectProps) {
  const options = React.useMemo(() => {
    const out: Opt[] = [];
    collect(children, undefined, out);
    return out;
  }, [children]);

  const [inner, setInner] = React.useState(() => (defaultValue != null ? String(defaultValue) : ''));
  const current = value !== undefined && value !== null ? String(value) : inner;
  const selected = options.find((o) => o.value === current) ?? (current === '' ? options[0] : undefined);

  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [query, setQuery] = React.useState('');
  const [pos, setPos] = React.useState<{ left: number; top?: number; bottom?: number; width: number; maxH: number } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();

  const searchable = options.length > 10;
  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const place = React.useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const flip = below < 200 && above > below;
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 180) - 8)),
      width: r.width,
      maxH: Math.min(320, flip ? above : below),
      ...(flip ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
    });
  }, []);

  function openMenu() {
    if (disabled) return;
    setQuery('');
    setActive(Math.max(0, options.findIndex((o) => o.value === selected?.value)));
    place();
    setOpen(true);
  }

  function close(refocus = true) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  function pick(o: Opt) {
    if (o.disabled) return;
    close();
    if (value === undefined) setInner(o.value);
    if (o.value !== current && onChange) {
      const target = { value: o.value, name: name ?? '', id: id ?? '' };
      onChange({ target, currentTarget: target } as unknown as React.ChangeEvent<HTMLSelectElement>);
    }
  }

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      place();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, place]);

  React.useEffect(() => {
    if (open) menuRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  function move(from: number, dir: 1 | -1) {
    let i = from;
    for (;;) {
      const n = i + dir;
      if (n < 0 || n >= visible.length) return from;
      i = n;
      if (!visible[i].disabled) return i;
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => move(i, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => move(i, -1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(move(-1, 1)); }
    else if (e.key === 'End') { e.preventDefault(); setActive(move(visible.length, -1)); }
    else if (e.key === 'Enter' || (e.key === ' ' && !searchable)) { e.preventDefault(); if (visible[active]) pick(visible[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') setOpen(false);
    else if (!searchable && e.key.length === 1) {
      const k = e.key.toLowerCase();
      const hit = visible.findIndex((o, i) => i > active && !o.disabled && o.label.toLowerCase().startsWith(k));
      const wrap = hit >= 0 ? hit : visible.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(k));
      if (wrap >= 0) setActive(wrap);
    }
  }

  let lastGroup: string | undefined;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        name={name}
        title={title}
        autoFocus={autoFocus}
        disabled={disabled}
        style={style && { ...style, backgroundImage: 'none' }}
        data-value={current}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={aria['aria-label']}
        aria-labelledby={aria['aria-labelledby']}
        aria-describedby={aria['aria-describedby']}
        aria-invalid={aria['aria-invalid']}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
        className={cn(
          'flex min-w-0 cursor-pointer items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.node ?? selected?.label ?? ''}</span>
        <ChevronDown
          aria-hidden
          className={cn('size-3.5 shrink-0 opacity-60 transition-transform duration-150', open && 'rotate-180')}
        />
      </button>

      {open && pos && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            onKeyDown={onKeyDown}
            style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: Math.max(pos.width, 160), maxWidth: 420, maxHeight: pos.maxH, zIndex: 9999 }}
            className="flex flex-col overflow-hidden rounded-card border border-[var(--line-1)] bg-[var(--card)] text-[var(--ink-1)] shadow-[0_12px_32px_-8px_rgba(0,0,0,0.25)]"
          >
            {searchable && (
              <div className="border-b border-[var(--line-1)] p-2">
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                  placeholder={'Search\u2026'}
                  aria-label="Search options"
                  className="h-8 w-full rounded-ctl border border-[var(--line-1)] bg-[var(--card)] px-2.5 text-size-ui text-[var(--ink-1)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                />
              </div>
            )}
            <div id={listId} role="listbox" className="min-h-0 overflow-y-auto py-1">
              {visible.length === 0 && (
                <div className="px-3 py-4 text-center text-caption text-[var(--ink-3)]">No matches</div>
              )}
              {visible.map((o, i) => {
                const header = o.group && o.group !== lastGroup ? o.group : null;
                lastGroup = o.group;
                const isSel = o.value === selected?.value;
                return (
                  <React.Fragment key={`${o.group ?? ''}:${o.value}:${i}`}>
                    {header && (
                      <div className="px-3 pb-1 pt-2 text-caption text-[var(--ink-3)]" role="group" aria-label={header}>
                        {header}
                      </div>
                    )}
                    <div
                      role="option"
                      data-value={o.value}
                      data-idx={i}
                      aria-selected={isSel}
                      aria-disabled={o.disabled || undefined}
                      onMouseEnter={() => !o.disabled && setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(o)}
                      className={cn(
                        'mx-1 flex items-center gap-2 rounded-ctl px-2 py-1.5 text-size-ui',
                        o.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                        i === active && !o.disabled && 'bg-[color-mix(in_srgb,var(--ink-1)_6%,transparent)]',
                        isSel ? 'font-medium' : 'text-[var(--ink-2)]',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{o.node ?? o.label}</span>
                      <span aria-hidden className="w-3.5 shrink-0 text-[var(--brand-a-ink)]">
                        {isSel && <Check className="size-3.5" strokeWidth={2.5} />}
                      </span>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
