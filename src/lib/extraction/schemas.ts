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

export function getExtractionSchema(name: string): ExtractionSchema | undefined {
  return BY_NAME.get(name);
}

export const extractionSchemaNames = (): string[] => EXTRACTION_SCHEMAS.map((s) => s.name);

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
