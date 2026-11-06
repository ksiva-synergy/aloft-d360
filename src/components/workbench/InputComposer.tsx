'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowUp,
  Send,
  Square,
  Database,
  X,
  Plus,
  Loader2,
  ChevronDown,
  CheckCircle2,
  Check,
  Search,
  Zap,
} from 'lucide-react';
import { AVAILABLE_MODELS, type ModelOption } from '@/components/agent-lab/workbench/types';
import { type, inkOf } from '@/lib/typography/tokens';
import { cn } from '@/lib/utils';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };
const sans: React.CSSProperties = { fontFamily: 'var(--font-sans)' };

const GOLD = 'var(--brand-a)';
const MUTED = 'var(--wb-muted)';
const INK = 'var(--wb-ink)';
const INK_DIM = 'var(--wb-ink-dim)';
const SURFACE = 'var(--wb-surface)';
const SURFACE2 = 'var(--wb-surface2)';
const BORDER_SUBTLE = 'var(--wb-border-subtle)';
const BORDER_GOLD = 'color-mix(in srgb, var(--brand-a) 30%, transparent)';
const CANVAS = 'var(--wb-canvas)';
const GREEN = '#22c55e';

// ── Tool chips ─────────────────────────────────────────────────────────────────
interface ToolEntry {
  id: string;
  name: string;
  slug: string;
  status: string;
}

interface ToolChipsProps {
  attachedToolIds: string[];
  onAttach: (id: string) => void;
  onDetach: (id: string) => void;
}

function ToolChips({ attachedToolIds, onAttach, onDetach }: ToolChipsProps) {
  const [available, setAvailable] = useState<ToolEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/agent-lab/workbench/tools')
      .then(r => r.ok ? r.json() : { tools: [] })
      .then((d: { tools?: ToolEntry[] }) => setAvailable(d.tools ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const attached = available.filter(t => attachedToolIds.includes(t.id));
  const unattached = available.filter(t => !attachedToolIds.includes(t.id));
  const displayName = (name: string) => name.replace(/^Databricks:\s*/i, '');

  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
      {attached.map(tool => (
        <span
          key={tool.id}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            ...type['ui-regular'],
            fontWeight: 500,
            color: GOLD,
            background: 'color-mix(in srgb, var(--brand-a) 8%, transparent)',
            border: `1px solid color-mix(in srgb, var(--brand-a) 30%, transparent)`,
            borderRadius: 5,
            padding: '3px 8px 3px 6px',
            whiteSpace: 'nowrap',
          }}
        >
          <Database size={10} />
          {displayName(tool.name)}
          <button
            onClick={() => onDetach(tool.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: MUTED,
              padding: '0 0 0 2px',
              lineHeight: 1,
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = GOLD; }}
            onMouseLeave={e => { e.currentTarget.style.color = MUTED; }}
          >
            <X size={10} />
          </button>
        </span>
      ))}

      {/* + Tool button */}
      <div ref={dropRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen(o => !o)}
          disabled={unattached.length === 0 && !loading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            ...type['ui-regular'],
            color: inkOf(open ? GOLD : MUTED),
            background: 'transparent',
            border: `1px solid ${open ? BORDER_GOLD : 'rgba(74,96,128,0.35)'}`,
            borderRadius: 5,
            padding: '3px 8px',
            cursor: 'pointer',
            transition: 'color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => { if (!open) { e.currentTarget.style.color = INK_DIM; e.currentTarget.style.borderColor = 'rgba(174,185,199,0.35)'; } }}
          onMouseLeave={e => { if (!open) { e.currentTarget.style.color = MUTED; e.currentTarget.style.borderColor = 'rgba(74,96,128,0.35)'; } }}
        >
          {loading ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={10} />}
          Tool
        </button>

        <AnimatePresence>
          {open && unattached.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 8px)',
                left: 0,
                background: SURFACE2,
                border: `1px solid ${BORDER_GOLD}`,
                borderRadius: 8,
                overflow: 'hidden',
                minWidth: 240,
                zIndex: 200,
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              }}
            >
              <div style={{ padding: '8px 12px 6px', borderBottom: `1px solid ${BORDER_SUBTLE}` }}>
                <span style={{ ...type['ui-regular'], color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Attach tool
                </span>
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto', padding: '4px 0' }}>
                {unattached.map(tool => (
                  <button
                    key={tool.id}
                    onClick={() => { onAttach(tool.id); setOpen(false); }}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 12px',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--brand-a) 5%, transparent)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Database size={13} style={{ color: GOLD, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...sans, fontSize: 'var(--type-ui-regular-size)', color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {displayName(tool.name)}
                      </div>
                      <div style={{ ...type['ui-regular'], color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {tool.slug}
                      </div>
                    </div>
                    <span style={{
                      ...type['ui-regular'],
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: 6,
                      color: tool.status === 'active' ? GREEN : MUTED,
                      background: tool.status === 'active' ? 'rgba(34,197,94,0.10)' : 'rgba(74,96,128,0.15)',
                      flexShrink: 0,
                    }}>
                      {tool.status}
                    </span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Model selector (exported separately, used in the composer footer row) ─────
interface ModelSelectorProps {
  selectedModel: string;
  onModelChange: (key: string) => void;
  disabled?: boolean;
  models?: ModelOption[];
  align?: 'left' | 'right';
}

/**
 * Model vendors, in menu order. Gateway models all report `provider: 'llmlite'`, so the vendor
 * is read from the model's name and id instead.
 */
const VENDORS: { id: string; label: string; color: string; match: RegExp }[] = [
  { id: 'anthropic', label: 'Anthropic', color: '#D97757', match: /claude|anthropic/i },
  { id: 'openai',    label: 'OpenAI',    color: '#10A37F', match: /\bgpt|openai/i },
  { id: 'xai',       label: 'xAI',       color: 'var(--ink-2)', match: /grok|xai/i },
  { id: 'google',    label: 'Google',    color: '#4285F4', match: /gemini|google/i },
  { id: 'amazon',    label: 'Amazon',    color: '#FF9900', match: /nova|amazon|titan/i },
  { id: 'meta',      label: 'Meta',      color: '#0866FF', match: /llama|meta/i },
  { id: 'mistral',   label: 'Mistral',   color: '#FA520F', match: /mistral|mixtral|pixtral/i },
  { id: 'moonshot',  label: 'Moonshot',  color: '#60A5FA', match: /kimi|moonshot/i },
  { id: 'deepseek',  label: 'DeepSeek',  color: '#4D6BFE', match: /deepseek/i },
  { id: 'qwen',      label: 'Qwen',      color: '#615CED', match: /qwen/i },
];
const OTHER_VENDOR = { id: 'other', label: 'Other', color: 'var(--ink-3)', match: /$^/ };

function vendorOf(m: ModelOption) {
  const hay = `${m.label} ${m.bedrockId} ${m.key}`;
  return VENDORS.find(v => v.match.test(hay)) ?? VENDORS.find(v => v.id === m.provider) ?? OTHER_VENDOR;
}

/** Picker copy. Every option is an LLM Lite model, so the gateway name stays off the menu. */
function modelMenuLabel(label: string): string {
  return label.replace(/\s*\(LLM Lite\)\s*/gi, '').trim();
}

function VendorMark({ vendor, size = 'md' }: { vendor: (typeof VENDORS)[number]; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-semibold',
        size === 'sm' ? 'size-5 text-caption' : 'size-7 text-label',
      )}
      style={{ color: vendor.color, background: `color-mix(in srgb, ${vendor.color} 14%, transparent)` }}
    >
      {vendor.label[0]}
    </span>
  );
}

export function ModelSelector({ selectedModel, onModelChange, disabled, models, align = 'left' }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const options = models ?? AVAILABLE_MODELS;
  const current = options.find(m => m.key === selectedModel) ?? options[1] ?? options[0];
  const currentVendor = vendorOf(current);
  const canPickModel = options.length > 1;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery(''); }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const q = query.trim().toLowerCase();
  const groups = [...VENDORS, OTHER_VENDOR]
    .map(vendor => ({
      vendor,
      models: options.filter(m => vendorOf(m).id === vendor.id && (!q || `${m.label} ${vendor.label} ${m.description}`.toLowerCase().includes(q))),
    }))
    .filter(g => g.models.length > 0);
  // Flat order for keyboard movement — same order as rendered.
  const flat = groups.flatMap(g => g.models);

  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const openMenu = () => {
    if (!canPickModel || disabled) return;
    setQuery('');
    setActive(Math.max(0, flat.findIndex(m => m.key === selectedModel)));
    setOpen(true);
  };
  const close = () => { setOpen(false); setQuery(''); };
  const pick = (key: string) => { onModelChange(key); close(); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (flat[active]) pick(flat[active].key); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };

  let idx = -1;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : openMenu())}
        disabled={disabled || !canPickModel}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Choose model"
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-full border pl-1.5 pr-2.5 text-ui text-[var(--ink-1)] transition-colors duration-hover',
          'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] disabled:opacity-50',
          open
            ? 'border-[color-mix(in_srgb,var(--brand-a)_40%,var(--line-1))] bg-[var(--surface-2)]'
            : 'border-[var(--line-1)] bg-transparent enabled:hover:bg-[var(--surface-2)]',
          !canPickModel && 'cursor-default',
        )}
      >
        <VendorMark vendor={currentVendor} size="sm" />
        <span className="whitespace-nowrap">{modelMenuLabel(current.label)}</span>
        {canPickModel && (
          <ChevronDown className={cn('size-3.5 shrink-0 text-[var(--ink-3)] transition-transform duration-hover', open && 'rotate-180')} />
        )}
      </button>

      <AnimatePresence>
        {open && canPickModel && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97, transition: { duration: 0.1 } }}
            transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
            onKeyDown={onKeyDown}
            className={cn(
              'absolute bottom-[calc(100%+8px)] z-[200] flex w-[264px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-[var(--line-1)] bg-[var(--card)] text-[var(--ink-1)] shadow-pop',
              align === 'right' ? 'right-0 origin-bottom-right' : 'left-0 origin-bottom-left',
            )}
          >
            <div className="p-1.5">
              <div className="flex h-8 items-center gap-2 rounded-full bg-[var(--surface-2)] px-3">
                <Search className="size-3.5 shrink-0 text-[var(--ink-3)]" aria-hidden />
                <input
                  autoFocus
                  value={query}
                  onChange={e => { setQuery(e.target.value); setActive(0); }}
                  placeholder="Search models"
                  aria-label="Search models"
                  className="min-w-0 flex-1 bg-transparent text-ui-regular text-[var(--ink-1)] outline-none placeholder:text-[var(--ink-3)]"
                />
              </div>
            </div>

            <div ref={listRef} role="listbox" aria-label="Models" className="model-menu-scroll max-h-[280px] overflow-y-auto px-1.5 pb-1.5">
              {flat.length === 0 && (
                <div className="px-3 py-6 text-center text-ui-regular text-[var(--ink-3)]">No models match &ldquo;{query.trim()}&rdquo;</div>
              )}
              {groups.map(({ vendor, models: vendorModels }) => (
                <div key={vendor.id} role="group" aria-label={vendor.label} className="pt-1 first:pt-0">
                  <div className="px-2 pb-0.5 pt-1.5 text-eyebrow text-[var(--ink-3)]">{vendor.label}</div>
                  {vendorModels.map(m => {
                    idx += 1;
                    const i = idx;
                    const isSelected = m.key === selectedModel;
                    return (
                      <button
                        key={m.key}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        data-idx={i}
                        onClick={() => pick(m.key)}
                        onMouseMove={() => { if (active !== i) setActive(i); }}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors duration-100',
                          i === active ? 'bg-[var(--surface-2)]' : 'bg-transparent',
                        )}
                      >
                        <VendorMark vendor={vendor} size="sm" />
                        <span className={cn('min-w-0 flex-1 truncate text-ui-regular', isSelected ? 'font-medium text-[var(--ink-1)]' : 'text-[var(--ink-2)]')}>
                          {modelMenuLabel(m.label)}
                        </span>
                        {m.supportsThinking && (
                          <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--brand-a)_12%,transparent)] px-2 text-caption text-[var(--brand-a-ink)]">Thinking</span>
                        )}
                        {!m.supportsTools && (
                          <span className="shrink-0 rounded-full bg-[var(--surface-3)] px-2 text-caption text-[var(--ink-3)]">No tools</span>
                        )}
                        <Check className={cn('size-3.5 shrink-0 text-[var(--brand-a)]', !isSelected && 'invisible')} aria-hidden />
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between border-t border-[var(--line-1)] px-3 py-1.5 text-caption text-[var(--ink-3)]">
              <span>{options.length} models</span>
              <span>↑↓ to move · Enter to pick</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── InputComposer (main export) ────────────────────────────────────────────────
export interface InputComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCommission?: () => void;
  onStop?: () => void;
  isStreaming: boolean;
  isCommissioning?: boolean;
  selectedModel: string;
  onModelChange: (v: string) => void;
  attachedToolIds?: string[];
  onAttachTool?: (id: string) => void;
  onDetachTool?: (id: string) => void;
  placeholder?: string;
  minLength?: number;
  /** When false, the COMMISSION button is greyed out and disabled. Defaults to true. */
  canCommission?: boolean;
  modelOptions?: ModelOption[];
  /** `center` = empty-state column (no dock chrome); `dock` = pinned footer bar. */
  layout?: 'dock' | 'center';
  /** Cap composer width (px) and center in the pane; omit for full-bleed (e.g. Inspector). */
  columnMaxWidth?: number;
  /** `inline` = Agents-chat style: one rounded box with model picker beside a round send button. */
  variant?: 'toolbar' | 'inline';
}

export function InputComposer({
  value,
  onChange,
  onSubmit,
  onCommission,
  onStop,
  isStreaming,
  isCommissioning = false,
  selectedModel,
  onModelChange,
  attachedToolIds = [],
  onAttachTool,
  onDetachTool,
  placeholder = 'Describe your agent mission…',
  minLength = 10,
  canCommission = true,
  modelOptions,
  layout = 'dock',
  columnMaxWidth,
  variant = 'toolbar',
}: InputComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const busy = isStreaming || isCommissioning;
  const canSend = value.trim().length >= minLength && !busy;
  const [focused, setFocused] = useState(false);

  // Auto-focus when not busy
  useEffect(() => {
    if (!busy) textareaRef.current?.focus();
  }, [busy]);

  // Auto-resize textarea
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxH = parseInt(getComputedStyle(el).lineHeight || '22') * 7;
    el.style.height = Math.min(el.scrollHeight, maxH) + 'px';
  }, []);

  useEffect(() => { resizeTextarea(); }, [value, resizeTextarea]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      if (canSend) onSubmit();
    }
  };

  const borderColor = focused
    ? 'color-mix(in srgb, var(--brand-a) 45%, transparent)'
    : BORDER_SUBTLE;

  const centered = layout === 'center';
  const widthCap = columnMaxWidth != null && columnMaxWidth > 0 ? columnMaxWidth : undefined;

  if (variant === 'inline') {
    return (
      <div
        className={centered ? 'w-full' : 'w-full shrink-0 px-4 pb-4 pt-2 md:px-6'}
        style={{ maxWidth: widthCap, marginLeft: widthCap ? 'auto' : undefined, marginRight: widthCap ? 'auto' : undefined, boxSizing: 'border-box' }}
      >
        <form
          className="flex w-full items-end gap-2 rounded-2xl border bg-[var(--surface-1)] p-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.12)] transition-[border-color] duration-200"
          style={{ borderColor: focused ? 'color-mix(in srgb, var(--brand-a) 45%, transparent)' : 'var(--line-1)' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend) onSubmit();
          }}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={e => { onChange(e.target.value); resizeTextarea(); }}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={busy ? 'Generating…' : placeholder}
            disabled={busy}
            rows={1}
            className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-size-body leading-relaxed text-[var(--ink-1)] outline-none placeholder:text-[var(--ink-3)]"
          />
          <div className="shrink-0 self-end pb-0.5">
            <ModelSelector
              selectedModel={selectedModel}
              onModelChange={onModelChange}
              disabled={busy}
              models={modelOptions}
              align="right"
            />
          </div>
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop"
              title="Stop generation"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--line-1)] text-[var(--ink-1)]"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send"
              title="Send (Enter)"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-a)] text-white disabled:opacity-40"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </form>
        <p className="mt-2 w-full text-center text-[length:var(--type-caption-size)] text-[var(--ink-3)]">
          Enter to send · Shift+Enter for a new line
        </p>
      </div>
    );
  }

  return (
    <footer style={{
      borderTop: centered ? 'none' : `1px solid ${BORDER_SUBTLE}`,
      background: centered ? 'transparent' : SURFACE,
      padding: centered ? 0 : '12px 16px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      flexShrink: 0,
      width: '100%',
      maxWidth: widthCap,
      marginLeft: widthCap ? 'auto' : undefined,
      marginRight: widthCap ? 'auto' : undefined,
      boxSizing: 'border-box',
    }}>
      {/* Composer box */}
      <div style={{
        border: `1px solid ${borderColor}`,
        borderRadius: 10,
        background: CANVAS,
        transition: 'border-color 0.2s',
        overflow: 'hidden',
      }}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => { onChange(e.target.value); resizeTextarea(); }}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={busy ? '' : placeholder}
          disabled={busy}
          rows={1}
          style={{
            width: '100%',
            resize: 'none',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            ...type['ui-regular'],
            color: busy ? MUTED : INK,
            padding: '14px 16px 10px',
            lineHeight: 1.6,
            cursor: busy ? 'not-allowed' : 'text',
            display: 'block',
            boxSizing: 'border-box',
            minHeight: 52,
            maxHeight: 176,
            overflowY: 'auto',
          }}
        />

        {/* Busy overlay pulse text */}
        {busy && (
          <div style={{
            padding: '2px 16px 10px',
            ...type['ui-regular'],
            color: GOLD,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <Loader2 size={11} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
            {isCommissioning ? 'Commissioning agent…' : 'Generating…'}
          </div>
        )}
      </div>

      {/* Bottom toolbar row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {/* Left: tool chips + model */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
          {onAttachTool && (
            <ToolChips
              attachedToolIds={attachedToolIds}
              onAttach={onAttachTool}
              onDetach={onDetachTool ?? (() => {})}
            />
          )}
          <ModelSelector
            selectedModel={selectedModel}
            onModelChange={onModelChange}
            disabled={busy}
            models={modelOptions}
          />
        </div>

        {/* Right: hint + send/stop */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {!busy && (
            <span style={{ ...type['ui-regular'], color: MUTED, whiteSpace: 'nowrap' }}>
              ↵ send · ⇧↵ newline
            </span>
          )}

          {busy ? (
            // Stop button
            <button
              onClick={onStop}
              title="Stop generation"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 36,
                height: 36,
                borderRadius: 8,
                background: 'rgba(239,68,68,0.12)',
                border: '1px solid rgba(239,68,68,0.3)',
                cursor: 'pointer',
                color: '#ef4444',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)'; }}
            >
              <Square size={14} />
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {/* Chat Send button */}
              <button
                onClick={onSubmit}
                disabled={!canSend}
                title="Chat (Enter)"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: canSend ? 'color-mix(in srgb, var(--brand-a) 12%, transparent)' : 'color-mix(in srgb, var(--brand-a) 5%, transparent)',
                  border: `1px solid ${canSend ? 'color-mix(in srgb, var(--brand-a) 30%, transparent)' : 'color-mix(in srgb, var(--brand-a) 10%, transparent)'}`,
                  cursor: canSend ? 'pointer' : 'not-allowed',
                  color: canSend ? GOLD : MUTED,
                  transition: 'background 0.15s, transform 0.1s',
                }}
                onMouseEnter={e => { if (canSend) e.currentTarget.style.transform = 'scale(1.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
              >
                <Send size={14} />
              </button>

              {/* Commission button — fires the Observer pipeline */}
              {onCommission && (
                <button
                  onClick={onCommission}
                  disabled={!canCommission}
                  title={
                    !canCommission
                      ? 'Need agent name, class, and instructions (40+ chars) saved in the draft — check the right panel'
                      : 'Commission agent (runs the Observer pipeline)'
                  }
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    height: 36,
                    borderRadius: 8,
                    background: canCommission ? GOLD : 'color-mix(in srgb, var(--brand-a) 12%, transparent)',
                    border: 'none',
                    cursor: canCommission ? 'pointer' : 'not-allowed',
                    color: canCommission ? '#001f3f' : MUTED,
                    ...type.ui,
                    padding: '0 14px',
                    transition: 'background 0.15s, transform 0.1s',
                    whiteSpace: 'nowrap',
                    opacity: canCommission ? 1 : 0.5,
                  }}
                  onMouseEnter={e => { if (canCommission) e.currentTarget.style.transform = 'scale(1.04)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                >
                  <Zap size={12} />
                  Commission
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </footer>
  );
}
