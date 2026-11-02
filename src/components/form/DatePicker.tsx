'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Themed replacement for <input type="date">. Value is an ISO "YYYY-MM-DD" string
 * (or ''), min/max are the same format, and onChange receives the new string.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parse(s?: string | null): Date | null {
  const m = s && /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  id?: string;
  title?: string;
  'aria-label'?: string;
  clearable?: boolean;
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'Select date',
  disabled,
  className,
  style,
  id,
  title,
  clearable = true,
  ...aria
}: DatePickerProps) {
  const selected = parse(value);
  const minD = parse(min);
  const maxD = parse(max);
  const todayIso = toIso(new Date());

  const [open, setOpen] = React.useState(false);
  const [focused, setFocused] = React.useState<Date>(() => selected ?? new Date());
  const [pos, setPos] = React.useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const isDisabled = (d: Date) => (minD && d < minD) || (maxD && d > maxD) || false;

  const place = React.useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const flip = window.innerHeight - r.bottom < 340 && r.top > window.innerHeight - r.bottom;
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - 272)),
      ...(flip ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
    });
  }, []);

  function openMenu() {
    if (disabled) return;
    setFocused(selected ?? (maxD && new Date() > maxD ? maxD : new Date()));
    place();
    setOpen(true);
  }

  function close(refocus = true) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  function pick(d: Date) {
    if (isDisabled(d)) return;
    onChange(toIso(d));
    close();
  }

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) place();
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
    if (open) menuRef.current?.querySelector<HTMLElement>('[data-focus="true"]')?.focus();
  }, [open, focused]);

  const year = focused.getFullYear();
  const month = focused.getMonth();
  const first = new Date(year, month, 1);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(first, i - first.getDay()));

  function shiftMonth(delta: number) {
    const last = new Date(year, month + delta + 1, 0).getDate();
    setFocused(new Date(year, month + delta, Math.min(focused.getDate(), last)));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in step) { e.preventDefault(); setFocused(addDays(focused, step[e.key])); }
    else if (e.key === 'PageUp') { e.preventDefault(); shiftMonth(-1); }
    else if (e.key === 'PageDown') { e.preventDefault(); shiftMonth(1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') setOpen(false);
  }

  const label = selected ? `${MONTHS[selected.getMonth()].slice(0, 3)} ${selected.getDate()}, ${selected.getFullYear()}` : placeholder;
  const navBtn = 'grid size-7 place-items-center rounded-ctl text-[var(--ink-2)] transition-colors hover:bg-[color-mix(in_srgb,var(--ink-1)_6%,transparent)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        title={title}
        disabled={disabled}
        style={style}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={aria['aria-label']}
        onClick={() => (open ? close() : openMenu())}
        className={cn(
          'inline-flex cursor-pointer items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60',
          !selected && 'opacity-70',
          className,
        )}
      >
        <CalendarIcon aria-hidden className="size-3.5 shrink-0 opacity-60" />
        <span className="min-w-0 flex-1 whitespace-nowrap tabular-nums">{label}</span>
      </button>

      {open && pos && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-label="Choose date"
            onKeyDown={onKeyDown}
            style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, zIndex: 9999, width: 264 }}
            className="rounded-card border border-[var(--line-1)] bg-[var(--card)] p-3 text-[var(--ink-1)] shadow-[0_12px_32px_-8px_rgba(0,0,0,0.25)]"
          >
            <div className="mb-2 flex items-center justify-between">
              <button type="button" aria-label="Previous month" className={navBtn} onClick={() => shiftMonth(-1)}>
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <div className="text-size-ui font-medium" aria-live="polite">{MONTHS[month]} {year}</div>
              <button type="button" aria-label="Next month" className={navBtn} onClick={() => shiftMonth(1)}>
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-y-0.5 text-center" role="grid">
              {DAYS.map((d) => (
                <div key={d} className="pb-1 text-caption text-[var(--ink-3)]" role="columnheader">{d}</div>
              ))}
              {cells.map((d) => {
                const iso = toIso(d);
                const outside = d.getMonth() !== month;
                const isSel = iso === value;
                const isFocus = iso === toIso(focused);
                const dis = isDisabled(d);
                return (
                  <button
                    key={iso}
                    type="button"
                    role="gridcell"
                    tabIndex={isFocus ? 0 : -1}
                    data-focus={isFocus}
                    aria-selected={isSel}
                    aria-current={iso === todayIso ? 'date' : undefined}
                    disabled={dis}
                    onClick={() => pick(d)}
                    className={cn(
                      'mx-auto grid size-8 place-items-center rounded-ctl text-size-ui tabular-nums transition-colors focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
                      outside && 'text-[var(--ink-3)] opacity-50',
                      dis && 'cursor-not-allowed opacity-30',
                      !dis && !isSel && 'hover:bg-[color-mix(in_srgb,var(--ink-1)_6%,transparent)]',
                      iso === todayIso && !isSel && 'font-semibold text-[var(--brand-a-ink)]',
                      isSel && 'bg-[var(--brand-a)] font-medium text-white',
                    )}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-[var(--line-1)] pt-2 text-caption">
              <button
                type="button"
                disabled={isDisabled(parse(todayIso)!)}
                onClick={() => pick(parse(todayIso)!)}
                className="rounded-ctl px-2 py-1 text-[var(--brand-a-ink)] hover:underline disabled:opacity-40 disabled:no-underline"
              >
                Today
              </button>
              {clearable && value && (
                <button
                  type="button"
                  onClick={() => { onChange(''); close(); }}
                  className="rounded-ctl px-2 py-1 text-[var(--ink-3)] hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
