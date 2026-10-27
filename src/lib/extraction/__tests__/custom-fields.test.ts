/**
 * A step's own field list for document.extract: the rules for a usable list, how it becomes a
 * schema, that a bad list is flagged while editing (policy check) and in a test run, and that a
 * test run returns the user's fields.
 */
import { describe, expect, it } from 'vitest';
import { builtinCapabilityRegistry } from '@/lib/capabilities/registry';
import type { PolicyContext } from '@/lib/capabilities/types';
import { analyzeFlow } from '@/lib/flows/analyze';
import { checkCustomFields, modelJsonSchema, resolveExtractionSchema, schemaFromFields, type CustomField } from '../schemas';

const fields: CustomField[] = [
  { key: 'vessel_name', label: 'Vessel name', type: 'text', description: 'Name of the vessel inspected' },
  { key: 'inspection_date', type: 'date', description: 'Date of the inspection' },
  { key: 'deficiencies', label: 'Deficiencies', type: 'number', description: 'Number of deficiencies recorded' },
];

describe('custom field rules', () => {
  it('accepts a good list and builds a schema with labels', () => {
    expect(checkCustomFields(fields)).toEqual([]);
    const s = schemaFromFields(fields);
    expect(s.name).toBe('custom');
    expect(s.fields.inspection_date).toEqual({ label: 'Inspection date', type: 'date', description: 'Date of the inspection' });
    expect((modelJsonSchema(s) as { properties: { fields: { required: string[] } } }).properties.fields.required).toEqual(['vessel_name', 'inspection_date', 'deficiencies']);
  });

  it('explains what is wrong with a bad list', () => {
    expect(checkCustomFields([])).toEqual(['add at least one field']);
    expect(checkCustomFields('vessel')).toEqual(['fields must be a list of { key, type, description }']);
    expect(checkCustomFields(Array.from({ length: 31 }, (_, i) => ({ key: `f${i}`, type: 'text', description: 'x' })))).toEqual(['at most 30 fields']);
    const problems = checkCustomFields([
      { key: 'Vessel Name', type: 'text', description: 'x' },
      { key: 'date', type: 'datetime', description: '' },
      { key: 'date', type: 'date', description: 'y' },
    ]);
    expect(problems).toEqual([
      expect.stringMatching(/field 1: key must be lowercase/),
      'field 2: type must be text, date, number',
      'field 2: describe what to read (1–300 characters)',
      'field 3: "date" is used twice',
    ]);
  });

  it('needs exactly one of a built-in schema or own fields', () => {
    expect(resolveExtractionSchema({ schema: 'seafarer_certificate' })).toMatchObject({ ok: true, schema: { name: 'seafarer_certificate' } });
    expect(resolveExtractionSchema({ fields })).toMatchObject({ ok: true, schema: { name: 'custom' } });
    expect(resolveExtractionSchema({ schema: 'seafarer_certificate', fields })).toEqual({ ok: false, problems: ['set either a built-in schema or your own fields, not both'] });
    expect(resolveExtractionSchema({})).toMatchObject({ ok: false, problems: [expect.stringMatching(/choose what to read/)] });
    expect(resolveExtractionSchema({ schema: 'payslip' })).toMatchObject({ ok: false, problems: [expect.stringMatching(/unknown extraction schema "payslip"/)] });
  });
});

describe('document.extract with own fields in a flow', () => {
  const policy: PolicyContext = { actorId: 'u-1', tenantId: 'org-1', permissions: new Set(['inspector:use']), egress: { emailDomains: [] } };
  const flow = (input: Record<string, unknown>) => ({
    name: 'Inspection reports',
    budget: { maxCostUsd: 1 },
    steps: [{ id: 'read_report', type: 'tool', config: { capability: 'document.extract', input: { connection: 'c-1', key: 'reports/a.pdf', ...input } } }],
  });

  it('flags a bad field list while editing, without running anything', async () => {
    const a = await analyzeFlow(flow({ fields: [{ key: 'x', type: 'colour', description: 'y' }] }), { registry: builtinCapabilityRegistry, policy });
    if (!a.ok) throw new Error(JSON.stringify(a.issues));
    expect(a.findings).toContainEqual({ severity: 'error', code: 'invalid_input', stepId: 'read_report', message: 'field 1: type must be text, date, number' });
    const neither = await analyzeFlow(flow({}), { registry: builtinCapabilityRegistry, policy });
    expect(neither.ok && neither.findings.some((f) => f.code === 'invalid_input' && /choose what to read/.test(f.message))).toBe(true);
  });

  it('runs a test with the user’s fields and describes the step by its field count', async () => {
    const a = await analyzeFlow(flow({ fields }), { registry: builtinCapabilityRegistry, policy, simulate: true });
    if (!a.ok) throw new Error(JSON.stringify(a.issues));
    expect(a.findings.filter((f) => f.severity === 'error')).toEqual([]);
    const step = a.simulation!.steps[0]!;
    expect(step.status).toBe('succeeded');
    expect(step.output).toMatchObject({ schema: 'custom', values: { vessel_name: null, inspection_date: null, deficiencies: null }, missing: ['vessel_name', 'inspection_date', 'deficiencies'] });
    expect(step.effect).toBe('Extract 3 fields from "reports/a.pdf"');
  });
});
