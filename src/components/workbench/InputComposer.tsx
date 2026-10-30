'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
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
                      borderRadius: 4,
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

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#f97316',
  mistral:   '#a78bfa',
  openai:    '#22c55e',
  xai:       '#e2e8f0',
  moonshot:  '#60a5fa',
  deepseek:  '#38bdf8',
  qwen:      '#fb923c',
  llmlite:   '#2dd4bf',
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  mistral:   'Mistral',
  openai:    'OpenAI',
  xai:       'xAI',
  moonshot:  'Moonshot',
  deepseek:  'DeepSeek',
  qwen:      'Qwen',
  llmlite:   'LLM Lite',
};

const chipStyle = (color: string): React.CSSProperties => ({
  ...type['ui-regular'],
  display: 'inline-flex',
  alignItems: 'center',
  padding: '1px 6px',
  borderRadius: 999,
  color,
  background: `color-mix(in srgb, ${color} 12%, transparent)`,
  border: `1px solid color-mix(in srgb, ${color} 22%, transparent)`,
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
});

export function ModelSelector({ selectedModel, onModelChange, disabled, models, align = 'left' }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const options = models ?? AVAILABLE_MODELS;
  const current = options.find(m => m.key === selectedModel) ?? options[1] ?? options[0];
  const providerColor = PROVIDER_COLORS[current.provider] ?? MUTED;
  const canPickModel = options.length > 1;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter(m => `${m.label} ${m.provider} ${m.description}`.toLowerCase().includes(q))
    : options;
  const grouped = filtered.reduce<Record<string, ModelOption[]>>((acc, m) => {
    acc[m.provider] = acc[m.provider] ? [...acc[m.provider], m] : [m];
    return acc;
  }, {});
  const close = () => { setOpen(false); setQuery(''); };
  const pick = (key: string) => { onModelChange(key); close(); };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => { if (canPickModel && !disabled) { setQuery(''); setOpen(o => !o); } }}
        disabled={disabled || !canPickModel}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          background: open ? 'color-mix(in srgb, var(--brand-a) 8%, transparent)' : SURFACE,
          border: `1px solid ${open ? BORDER_GOLD : BORDER_SUBTLE}`,
          cursor: disabled || !canPickModel ? 'default' : 'pointer',
          padding: '4px 10px 4px 8px',
          borderRadius: 999,
          opacity: disabled ? 0.5 : 1,
          transition: 'background 0.15s, border-color 0.15s',
        }}
        onMouseEnter={e => { if (!disabled && canPickModel && !open) e.currentTarget.style.borderColor = BORDER_GOLD; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.borderColor = BORDER_SUBTLE; }}
      >
        <span style={{ width: 7, height: 7, borderRadius: 999, background: providerColor, boxShadow: `0 0 0 3px color-mix(in srgb, ${providerColor} 18%, transparent)`, flexShrink: 0 }} />
        <span style={{ ...type['ui-regular'], color: INK, fontWeight: 500, whiteSpace: 'nowrap' }}>
          {current.label}
        </span>
        {canPickModel && (
          <ChevronDown size={11} style={{ color: MUTED, flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        )}
      </button>

      <AnimatePresence>
        {open && canPickModel && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 8px)',
              [align]: 0,
              background: SURFACE2,
              border: `1px solid ${BORDER_SUBTLE}`,
              borderRadius: 14,
              overflow: 'hidden',
              width: 320,
              zIndex: 200,
              boxShadow: '0 16px 48px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.25)',
              transformOrigin: align === 'right' ? 'bottom right' : 'bottom left',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: `1px solid ${BORDER_SUBTLE}` }}>
              <Search size={13} style={{ color: MUTED, flexShrink: 0 }} />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && filtered[0]) { e.preventDefault(); pick(filtered[0].key); }
                }}
                placeholder="Search models"
                aria-label="Search models"
                style={{ ...type['ui-regular'], flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: INK }}
              />
            </div>
            <div role="listbox" aria-label="Models" style={{ maxHeight: 340, overflowY: 'auto', padding: 6 }}>
              {filtered.length === 0 && (
                <div style={{ ...type['ui-regular'], color: MUTED, padding: '16px 8px', textAlign: 'center' }}>No models match</div>
              )}
              {Object.entries(grouped).map(([provider, models]) => {
                const color = PROVIDER_COLORS[provider] ?? MUTED;
                return (
                  <div key={provider} style={{ marginBottom: 4 }}>
                    <div style={{ padding: '8px 8px 4px', ...type['ui-regular'], color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>
                      {PROVIDER_LABELS[provider] ?? provider}
                    </div>
                    {models.map(m => {
                      const isActive = m.key === selectedModel;
                      return (
                        <button
                          key={m.key}
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          onClick={() => pick(m.key)}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '8px 8px',
                            borderRadius: 9,
                            background: isActive ? 'color-mix(in srgb, var(--brand-a) 10%, transparent)' : 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'background 0.1s',
                          }}
                          onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'color-mix(in srgb, var(--brand-a) 5%, transparent)'; }}
                          onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                        >
                          <span
                            aria-hidden
                            style={{
                              width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              background: `color-mix(in srgb, ${color} 14%, transparent)`,
                              border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
                              color, ...sans, fontSize: 12, fontWeight: 700,
                            }}
                          >
                            {(PROVIDER_LABELS[provider] ?? provider).charAt(0)}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{ ...sans, fontSize: 'var(--type-ui-regular-size)', color: INK, fontWeight: isActive ? 600 : 500 }}>
                                {m.label}
                              </span>
                              {m.supportsThinking && <span style={chipStyle('#8b5cf6')}>Thinking</span>}
                              {!m.supportsTools && <span style={chipStyle('#94a3b8')}>No tools</span>}
                            </div>
                            <div style={{ ...type['ui-regular'], color: MUTED, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m.description}
                            </div>
                          </div>
                          {isActive && <Check size={14} style={{ color: GOLD, flexShrink: 0 }} />}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
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
