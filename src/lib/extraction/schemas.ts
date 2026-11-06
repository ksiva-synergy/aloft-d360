// Named extraction schemas: which fields `document.extract` reads from a document. A step names one
// (`schema: "seafarer_certificate"`); the model is asked for exactly these fields and nothing else.
// Pure data, so the capability contracts, the copilot prompt and the UI can all import it.

export type ExtractionFieldType = 'text' | 'date' | 'number';
export type ExtractionField = { label: string; type: ExtractionFieldType; description: string };
export type ExtractionSchema = { name: string; title: string; description: string; fields: Record<string, ExtractionField> };

const text = (label: string, description: string): ExtractionField => ({ label, type: 'text', description });
const date = (label: string, description: string): ExtractionField => ({ label, type: 'date', description });

export const EXTRACTION_SCHEMAS: readonly ExtractionSchema[] = [
  {
    name: 'seafarer_certificate',
    title: 'Seafarer certificate',
    description: 'An STCW certificate of competency or proficiency, an endorsement, or a similar seafarer certificate.',
    fields: {
      holder_name: text('Holder name', 'Full name of the certificate holder, as printed'),
      date_of_birth: date('Date of birth', 'Date of birth of the holder'),
      nationality: text('Nationality', 'Nationality of the holder'),
      certificate_type: text('Certificate type', 'Title of the certificate, e.g. "Certificate of Competency" or "Certificate of Proficiency – Basic Training"'),
      certificate_number: text('Certificate number', 'Certificate or document number, exactly as printed'),
      capacity: text('Capacity', 'Capacity, rank or grade the certificate is for, e.g. "Master", "Chief Engineer Officer"'),
      stcw_regulation: text('STCW regulation', 'STCW regulation(s) cited, e.g. "II/2" or "VI/1"'),
      limitations: text('Limitations', 'Any limitations printed on the certificate, e.g. tonnage, trading area or near-coastal'),
      issuing_authority: text('Issuing authority', 'Administration or authority that issued it'),
      place_of_issue: text('Place of issue', 'Place where it was issued'),
      issue_date: date('Issue date', 'Date of issue'),
      expiry_date: date('Expiry date', 'Date of expiry or "valid until" date; null if none is printed'),
    },
  },
  {
    name: 'seafarer_medical',
    title: 'Seafarer medical certificate',
    description: 'A seafarer medical fitness certificate (e.g. ENG1, PEME, flag-state medical under STCW I/9 or MLC).',
    fields: {
      holder_name: text('Holder name', 'Full name of the seafarer, as printed'),
      date_of_birth: date('Date of birth', 'Date of birth of the seafarer'),
      certificate_number: text('Certificate number', 'Certificate number, exactly as printed'),
      examination_date: date('Examination date', 'Date of the medical examination'),
      expiry_date: date('Expiry date', 'Date the certificate expires'),
      fitness: text('Fitness', 'Fitness decision as printed, e.g. "Fit for look-out duties", "Fit with restrictions", "Unfit"'),
      restrictions: text('Restrictions', 'Any restrictions or limitations printed'),
      examiner: text('Examiner or clinic', 'Name of the examining doctor or clinic'),
    },
  },
];

const BY_NAME = new Map(EXTRACTION_SCHEMAS.map((s) => [s.name, s]));

export function getExtractionSchema(name: unknown): ExtractionSchema | undefined {
  return typeof name === 'string' ? BY_NAME.get(name) : undefined;
}

export const extractionSchemaNames = (): string[] => EXTRACTION_SCHEMAS.map((s) => s.name);

// ── Fields defined by the user in the step, instead of a built-in schema ────────────────────────

export const EXTRACTION_FIELD_TYPES = ['text', 'date', 'number'] as const;
export const MAX_CUSTOM_FIELDS = 30;
const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** One field as saved in a step: `{ key, type, description, label? }`. */
export type CustomField = { key: string; type: ExtractionFieldType; description: string; label?: string };

/** Problems with a step's own field list; empty when it can be used. */
export function checkCustomFields(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ['fields must be a list of { key, type, description }'];
  if (raw.length === 0) return ['add at least one field'];
  if (raw.length > MAX_CUSTOM_FIELDS) return [`at most ${MAX_CUSTOM_FIELDS} fields`];
  const problems: string[] = [];
  const seen = new Set<string>();
  raw.forEach((f, i) => {
    const n = `field ${i + 1}`;
    if (!f || typeof f !== 'object') return void problems.push(`${n} must be { key, type, description }`);
    const { key, type, description, label } = f as Record<string, unknown>;
    if (typeof key !== 'string' || !FIELD_KEY.test(key)) problems.push(`${n}: key must be lowercase letters, digits and _ (start with a letter, up to 40), e.g. "expiry_date"`);
    else if (seen.has(key)) problems.push(`${n}: "${key}" is used twice`);
    else seen.add(key);
    if (!EXTRACTION_FIELD_TYPES.includes(type as ExtractionFieldType)) problems.push(`${n}: type must be ${EXTRACTION_FIELD_TYPES.join(', ')}`);
    if (typeof description !== 'string' || !description.trim() || description.length > 300) problems.push(`${n}: describe what to read (1–300 characters)`);
    if (label !== undefined && (typeof label !== 'string' || label.length > 80)) problems.push(`${n}: label must be text up to 80 characters`);
  });
  return problems;
}

const titleCase = (key: string) => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Types one answered value by its field type. Shared by document extraction and agent answers so
 * both accept the same things: a real YYYY-MM-DD date, a number (thousands commas allowed), text.
 */
export function typeFieldValue(type: ExtractionFieldType, raw: unknown): { value: string | number | null; issue?: string } {
  const text = typeof raw === 'string' && raw.trim() ? raw.trim() : typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : null;
  if (text === null) return { value: null };
  if (type === 'date') return isRealDate(text) ? { value: text } : { value: null, issue: `"${text}" is not a full date (YYYY-MM-DD)` };
  if (type === 'number') {
    const n = Number(text.replace(/,/g, ''));
    return Number.isFinite(n) ? { value: n } : { value: null, issue: `"${text}" is not a number` };
  }
  return { value: text };
}

/** A schema built from a step's own fields. Call checkCustomFields first. */
export function schemaFromFields(fields: CustomField[]): ExtractionSchema {
  return {
    name: 'custom',
    title: 'Fields chosen for this step',
    description: 'Any document; read only the fields listed.',
    fields: Object.fromEntries(fields.map((f) => [f.key, { label: f.label?.trim() || titleCase(f.key), type: f.type, description: f.description.trim() }])),
  };
}

/**
 * The schema a `document.extract` input asks for: a built-in `schema` name or the step's own
 * `fields`, exactly one of them. Returns the schema, or the problems to show.
 */
export function resolveExtractionSchema(input: { schema?: unknown; fields?: unknown }): { ok: true; schema: ExtractionSchema } | { ok: false; problems: string[] } {
  const hasSchema = input.schema !== undefined && input.schema !== '';
  const hasFields = input.fields !== undefined;
  if (hasSchema && hasFields) return { ok: false, problems: ['set either a built-in schema or your own fields, not both'] };
  if (hasFields) {
    const problems = checkCustomFields(input.fields);
    return problems.length ? { ok: false, problems } : { ok: true, schema: schemaFromFields(input.fields as CustomField[]) };
  }
  if (!hasSchema) return { ok: false, problems: [`choose what to read: a built-in schema (${extractionSchemaNames().join(', ')}) or your own fields`] };
  const schema = getExtractionSchema(input.schema);
  return schema ? { ok: true, schema } : { ok: false, problems: [`unknown extraction schema "${String(input.schema)}"; use one of ${extractionSchemaNames().join(', ')}, or your own fields`] };
}

/**
 * The JSON Schema the model must answer with: every field present, each with a value (or null), the
 * 1-based page it is on and the exact text it was read from. Strict-mode compatible (all keys
 * required, no extra keys); values are strings and are typed afterwards by parseExtraction.
 */
export function modelJsonSchema(schema: ExtractionSchema): Record<string, unknown> {
  const field = {
    type: 'object',
    additionalProperties: false,
    required: ['value', 'page', 'evidence'],
    properties: {
      value: { type: ['string', 'null'] },
      page: { type: ['integer', 'null'] },
      evidence: { type: ['string', 'null'] },
    },
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['document_type', 'fields'],
    properties: {
      document_type: { type: 'string', description: 'What the document is, in a few words' },
      fields: {
        type: 'object',
        additionalProperties: false,
        required: Object.keys(schema.fields),
        properties: Object.fromEntries(Object.entries(schema.fields).map(([k, f]) => [k, { ...field, description: f.description }])),
      },
    },
  };
}
