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
  Zap,
} from 'lucide-react';
import { AVAILABLE_MODELS, type ModelOption } from '@/components/agent-lab/workbench/types';

const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const sans: React.CSSProperties = { fontFamily: "'Inter Tight', system-ui, sans-serif" };

const GOLD = '#FDB515';
const MUTED = 'var(--wb-muted)';
const INK = 'var(--wb-ink)';
const INK_DIM = 'var(--wb-ink-dim)';
const SURFACE = 'var(--wb-surface)';
const SURFACE2 = 'var(--wb-surface2)';
const BORDER_SUBTLE = 'var(--wb-border-subtle)';
const BORDER_GOLD = 'rgba(253,181,21,0.30)';
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
            ...mono,
            fontSize: 11,
            fontWeight: 500,
            color: GOLD,
            background: 'rgba(253,181,21,0.08)',
            border: `1px solid rgba(253,181,21,0.30)`,
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
            ...mono,
            fontSize: 11,
            color: open ? GOLD : MUTED,
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
                <span style={{ ...mono, fontSize: 10, color: MUTED, letterSpacing: '0.10em', textTransform: 'uppercase' }}>
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
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(253,181,21,0.05)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Database size={13} style={{ color: GOLD, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...sans, fontSize: 12, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {displayName(tool.name)}
                      </div>
                      <div style={{ ...mono, fontSize: 10, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {tool.slug}
                      </div>
                    </div>
                    <span style={{
                      ...mono,
                      fontSize: 9,
                      fontWeight: 700,
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
}

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#f97316',
  mistral:   '#a78bfa',
  openai:    '#22c55e',
  xai:       '#e2e8f0',
  moonshot:  '#60a5fa',
  deepseek:  '#38bdf8',
  qwen:      '#fb923c',
};

export function ModelSelector({ selectedModel, onModelChange, disabled }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = AVAILABLE_MODELS.find(m => m.key === selectedModel) ?? AVAILABLE_MODELS[1];
  const providerColor = PROVIDER_COLORS[current.provider] ?? MUTED;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const grouped = AVAILABLE_MODELS.reduce<Record<string, ModelOption[]>>((acc, m) => {
    acc[m.provider] = acc[m.provider] ? [...acc[m.provider], m] : [m];
    return acc;
  }, {});

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          background: 'transparent',
          border: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          padding: '4px 6px',
          borderRadius: 5,
          opacity: disabled ? 0.5 : 1,
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'rgba(253,181,21,0.05)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        <Zap size={11} style={{ color: providerColor, flexShrink: 0 }} />
        <span style={{ ...mono, fontSize: 11, color: INK_DIM, whiteSpace: 'nowrap' }}>
          {current.label}
        </span>
        <ChevronDown size={10} style={{ color: MUTED, flexShrink: 0 }} />
      </button>

      <AnimatePresence>
        {open && (
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
              <span style={{ ...mono, fontSize: 10, color: MUTED, letterSpacing: '0.10em', textTransform: 'uppercase' }}>Model</span>
            </div>
            <div style={{ maxHeight: 280, overflowY: 'auto', padding: '4px 0' }}>
              {Object.entries(grouped).map(([provider, models]) => (
                <div key={provider}>
                  <div style={{ padding: '6px 12px 3px', ...mono, fontSize: 9, color: PROVIDER_COLORS[provider] ?? MUTED, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>
                    {provider}
                  </div>
                  {models.map(m => {
                    const isActive = m.key === selectedModel;
                    return (
                      <button
                        key={m.key}
                        onClick={() => { onModelChange(m.key); setOpen(false); }}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 10,
                          padding: '7px 12px',
                          background: isActive ? 'rgba(253,181,21,0.06)' : 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(253,181,21,0.04)'; }}
                        onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <div style={{ width: 14, paddingTop: 2, flexShrink: 0 }}>
                          {isActive && <CheckCircle2 size={12} style={{ color: GOLD }} />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ ...sans, fontSize: 12, color: isActive ? GOLD : INK, fontWeight: isActive ? 600 : 400 }}>
                            {m.label}
                            {m.supportsThinking && (
                              <span style={{ ...mono, fontSize: 9, color: '#8b5cf6', marginLeft: 6, letterSpacing: '0.06em' }}>thinking</span>
                            )}
                          </div>
                          <div style={{ ...mono, fontSize: 10, color: MUTED, marginTop: 1 }}>{m.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
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
    ? 'rgba(253,181,21,0.45)'
    : BORDER_SUBTLE;

  return (
    <footer style={{
      borderTop: `1px solid ${BORDER_SUBTLE}`,
      background: SURFACE,
      padding: '12px 16px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      flexShrink: 0,
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
            ...mono,
            fontSize: 14,
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
            ...mono,
            fontSize: 11,
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
          />
        </div>

        {/* Right: hint + send/stop */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {!busy && (
            <span style={{ ...mono, fontSize: 10, color: MUTED, whiteSpace: 'nowrap', opacity: focused ? 1 : 0.5, transition: 'opacity 0.2s' }}>
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
                  background: canSend ? 'rgba(253,181,21,0.12)' : 'rgba(253,181,21,0.05)',
                  border: `1px solid ${canSend ? 'rgba(253,181,21,0.3)' : 'rgba(253,181,21,0.1)'}`,
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
                  title={!canCommission ? 'Complete required fields first' : 'Commission agent (runs the Observer pipeline)'}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    height: 36,
                    borderRadius: 8,
                    background: canCommission ? GOLD : 'rgba(253,181,21,0.12)',
                    border: 'none',
                    cursor: canCommission ? 'pointer' : 'not-allowed',
                    color: canCommission ? '#001f3f' : MUTED,
                    ...mono,
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.1em',
                    padding: '0 14px',
                    transition: 'background 0.15s, transform 0.1s',
                    whiteSpace: 'nowrap',
                    opacity: canCommission ? 1 : 0.5,
                  }}
                  onMouseEnter={e => { if (canCommission) e.currentTarget.style.transform = 'scale(1.04)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                >
                  <Zap size={12} />
                  COMMISSION
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
