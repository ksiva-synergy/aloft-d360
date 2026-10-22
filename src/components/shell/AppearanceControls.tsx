'use client';

import { useEffect, useState } from 'react';
import { RotateCcw, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ACCENT_PRESETS, MODE_DEFAULTS, RAIL_PRESETS,
  loadAppearance, saveAppearance, type Appearance,
} from '@/lib/theme/appearance';
import { saveCompanionPreferences, useCompanionPreferences } from '@/hooks/useCompanionPreferences';

function Swatch({
  color, label, selected, onClick,
}: { color: string; label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={selected}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded-full ring-offset-2 ring-offset-[var(--surface-1)] transition-transform hover:scale-110',
        selected ? 'ring-2 ring-[var(--ink-1)]' : 'ring-1 ring-[var(--line-2)]',
      )}
      style={{ background: color }}
    >
      {selected && <Check className="h-3.5 w-3.5 text-white mix-blend-difference" strokeWidth={3} />}
    </button>
  );
}

function PickerRow({
  title, value, presets, onChange,
}: {
  title: string;
  value: string;
  presets: { name: string; hex: string }[];
  onChange: (hex: string) => void;
}) {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const isPreset = presets.some((p) => same(p.hex, value));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--ink-3)]">{title}</span>
        <span className="font-mono text-xs text-[var(--ink-3)]">{value.toUpperCase()}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-1">
        {presets.map((p) => (
          <Swatch key={p.hex} color={p.hex} label={p.name} selected={same(p.hex, value)} onClick={() => onChange(p.hex)} />
        ))}
        {/* Any color: the native picker, shown as a rainbow ring when a custom color is active */}
        <label
          title="Pick any color"
          className={cn(
            'relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-full ring-offset-2 ring-offset-[var(--surface-1)] transition-transform hover:scale-110',
            !isPreset ? 'ring-2 ring-[var(--ink-1)]' : 'ring-1 ring-[var(--line-2)]',
          )}
          style={{
            background: isPreset
              ? 'conic-gradient(#f43f5e,#f59e0b,#84cc16,#06b6d4,#6366f1,#d946ef,#f43f5e)'
              : value,
          }}
        >
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`Custom ${title.toLowerCase()} color`}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
          {!isPreset && <Check className="h-3.5 w-3.5 text-white mix-blend-difference" strokeWidth={3} />}
        </label>
      </div>
    </div>
  );
}

/** Accent + sidebar color pickers; changes apply live and are remembered in this browser. */
export function AppearanceControls() {
  const [state, setState] = useState<Appearance>({ accent: null, rail: null });

  const [dark, setDark] = useState(false);
  const companion = useCompanionPreferences();

  useEffect(() => {
    setState(loadAppearance());
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains('dark'));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  const defaults = MODE_DEFAULTS[dark ? 'dark' : 'light'];

  const update = (patch: Partial<Appearance>) => {
    const next = { ...state, ...patch };
    setState(next);
    saveAppearance(next);
    // Picking an app accent brings the companion back in step with it.
    if ('accent' in patch && companion.color !== 'accent') saveCompanionPreferences({ ...companion, color: 'accent' });
  };
  const customised = !!(state.accent || state.rail);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--ink-3)]">Colors</span>
        {customised && (
          <button
            type="button"
            onClick={() => update({ accent: null, rail: null })}
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-[var(--brand-a-ink)] transition-colors hover:bg-[var(--brand-a-soft)]"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        )}
      </div>
      <PickerRow
        title="Accent"
        value={state.accent ?? defaults.accent}
        presets={ACCENT_PRESETS}
        onChange={(hex) => update({ accent: hex })}
      />
      <PickerRow
        title="Sidebar"
        value={state.rail ?? defaults.rail}
        presets={RAIL_PRESETS}
        onChange={(hex) => update({ rail: hex })}
      />
    </div>
  );
}
