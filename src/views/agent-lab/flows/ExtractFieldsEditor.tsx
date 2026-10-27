'use client';

import { Plus, Trash2 } from 'lucide-react';
import { EXTRACTION_FIELD_TYPES, MAX_CUSTOM_FIELDS, checkCustomFields, type CustomField } from '@/lib/extraction/schemas';
import { btn } from './ui';

// The user's own field list for an "Extract document fields" step. People type a name ("Expiry
// date"); the key used in references ({{…values.expiry_date}}) is derived from it and shown.

const field = 'h-8 w-full rounded-lg border border-[var(--line-1)] bg-[var(--surface-1)] px-2 text-size-ui text-[var(--ink-1)] outline-none focus:border-[var(--brand-a)]';

/** "Expiry date (UTC)" → "expiry_date_utc"; a leading digit gets an `f_` prefix. */
export function fieldKey(name: string): string {
  const k = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 38);
  return /^[a-z]/.test(k) ? k : k ? `f_${k}` : '';
}

const TYPE_LABEL: Record<CustomField['type'], string> = { text: 'Text', date: 'Date', number: 'Number' };

export function ExtractFieldsEditor({ id, fields, onChange }: { id: string; fields: CustomField[]; onChange: (fields: CustomField[]) => void }) {
  const problems = checkCustomFields(fields);
  const patch = (i: number, p: Partial<CustomField>) => onChange(fields.map((f, n) => (n === i ? { ...f, ...p } : f)));

  return (
    <div className="space-y-2">
      <ul aria-label="Fields to read" className="space-y-2">
        {fields.map((f, i) => (
          <li key={i} className="rounded-lg border border-[var(--line-1)] p-2">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex gap-2">
                  <label className="sr-only" htmlFor={`${id}-name-${i}`}>
                    Field {i + 1} name
                  </label>
                  <input
                    id={`${id}-name-${i}`}
                    className={field}
                    placeholder="Name, e.g. Expiry date"
                    value={f.label ?? ''}
                    onChange={(e) => patch(i, { label: e.target.value, key: fieldKey(e.target.value) })}
                  />
                  <label className="sr-only" htmlFor={`${id}-type-${i}`}>
                    Field {i + 1} type
                  </label>
                  <select id={`${id}-type-${i}`} className={`${field} w-28 shrink-0`} value={f.type} onChange={(e) => patch(i, { type: e.target.value as CustomField['type'] })}>
                    {EXTRACTION_FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="sr-only" htmlFor={`${id}-desc-${i}`}>
                  Field {i + 1} description
                </label>
                <input
                  id={`${id}-desc-${i}`}
                  className={field}
                  placeholder="What to read, e.g. the date the certificate expires"
                  value={f.description}
                  onChange={(e) => patch(i, { description: e.target.value })}
                />
                {f.key && <p className="font-mono text-size-caption text-[var(--ink-3)]">values.{f.key}</p>}
              </div>
              <button type="button" className={btn.icon} aria-label={`Remove field ${f.label || i + 1}`} onClick={() => onChange(fields.filter((_, n) => n !== i))}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={btn.ghost}
        disabled={fields.length >= MAX_CUSTOM_FIELDS}
        onClick={() => onChange([...fields, { key: '', label: '', type: 'text', description: '' }])}
      >
        <Plus className="h-4 w-4" /> Add field
      </button>
      {problems.length > 0 && (
        <ul className="space-y-0.5 text-size-caption text-[var(--warn)]">
          {problems.slice(0, 4).map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
