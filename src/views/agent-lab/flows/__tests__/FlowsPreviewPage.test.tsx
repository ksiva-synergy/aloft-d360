// @vitest-environment jsdom
/**
 * UI wiring for the Flows builder: home → template → canvas → test run → save/publish, plus the
 * Edit panel, the code view and Copilot proposals. `fetch` is answered by the real flow core (no
 * HTTP server, no auth, no model), so the page renders what the API would actually return.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { chooseSelectValue } from '@/test/form-select';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FlowsPage from '../index';
import { FLOW_TEMPLATES } from '@/lib/flows/templates';
import { recommendTemplates } from '@/lib/flows/recommend';
import { analyzeFlow } from '@/lib/flows/analyze';
import { applyOperations, diffFlows, parseOperations } from '@/lib/flows/copilot';
import { builtinCapabilityRegistry } from '@/lib/capabilities/registry';

const publishing = { available: true, reason: 'Save the workflow, then publish it once it passes every check and a simulated run.' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type SavedRow = { id: string; name: string; status: string; version: number; definition: unknown; owner: string; updatedAt: string };
type CopilotReply = { reply: string; operations: unknown[] } | { status: number; error: string; code?: string };

function fakeApi(opts: { permissions?: string[]; flows?: SavedRow[]; publishError?: string; copilot?: (message: string) => CopilotReply } = {}) {
  const flows = opts.flows ?? [];
  const calls: { method: string; path: string; body?: any }[] = [];
  const policy = () => ({ actorId: 'u', tenantId: 'org', permissions: new Set(opts.permissions ?? ['inspector:use']), egress: { emailDomains: ['example.com'] } });
  const spy = vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://test');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body });
    const summary = (f: SavedRow) => ({ id: f.id, name: f.name, status: f.status, version: f.version, owner: f.owner, updatedAt: f.updatedAt });
    if (url.pathname === '/api/agent-lab/flows') {
      if (method === 'GET') return json(200, { flows: flows.map(summary) });
      const row: SavedRow = { id: `f${flows.length + 1}`, name: body.definition.name, status: 'draft', version: 1, definition: body.definition, owner: 'me', updatedAt: new Date().toISOString() };
      flows.push(row);
      return json(201, { flow: summary(row) });
    }
    if (url.pathname.endsWith('/catalog')) {
      const goal = url.searchParams.get('goal') ?? '';
      return json(200, { templates: FLOW_TEMPLATES, matches: goal ? recommendTemplates(goal, FLOW_TEMPLATES) : [], egress: { emailDomains: ['example.com'] }, publishing });
    }
    if (url.pathname.endsWith('/copilot')) {
      const r = opts.copilot?.(body.message) ?? { reply: 'No change.', operations: [] };
      if ('status' in r) return json(r.status, { error: r.error, details: r.code ? { code: r.code } : undefined });
      const parsed = parseOperations(r.operations);
      if (!parsed.ok || !parsed.operations.length) return json(200, { reply: r.reply, proposal: null });
      const applied = applyOperations(body.definition, parsed.operations);
      if (!applied.ok) return json(200, { reply: 'Could not apply.', proposal: null, problems: applied.errors });
      const analysis = await analyzeFlow(applied.definition, { registry: builtinCapabilityRegistry, policy: policy(), simulate: false });
      const before = await analyzeFlow(body.definition, { registry: builtinCapabilityRegistry, policy: policy(), simulate: false });
      const findings = analysis.ok ? analysis.findings : [];
      const had = new Set(before.ok ? before.findings.map((f) => f.message + f.stepId) : []);
      return json(200, { reply: r.reply, proposal: { definition: applied.definition, changes: applied.changes, diff: diffFlows(body.definition, applied.definition), findings, introduced: findings.filter((f) => !had.has(f.message + f.stepId)) } });
    }
    if (url.pathname.endsWith('/simulate')) {
      const analysis = await analyzeFlow(body.definition, { registry: builtinCapabilityRegistry, policy: policy(), simulate: true, inputs: body.inputs, fixtures: body.fixtures, faults: body.faults });
      return json(analysis.ok ? 200 : 422, { ...analysis, publishing });
    }
    const m = url.pathname.match(/^\/api\/agent-lab\/flows\/([^/]+)(?:\/(versions|publish))?$/)!;
    const row = flows.find((f) => f.id === m[1])!;
    if (!m[2]) return json(200, { flow: { ...summary(row), definition: row.definition } });
    if (m[2] === 'versions') {
      if (body.baseVersion !== row.version) return json(409, { error: 'changed', details: { latestVersion: row.version } });
      Object.assign(row, { version: row.version + 1, status: 'draft', definition: body.definition, name: body.definition.name });
      return json(201, { flow: summary(row) });
    }
    if (method === 'DELETE') {
      row.status = 'draft';
      return json(200, { flow: summary(row) });
    }
    if (opts.publishError) return json(422, { error: 'Publishing is blocked by policy checks', details: { findings: [{ message: opts.publishError }] } });
    row.status = 'active';
    return json(200, { flow: summary(row) });
  });
  return Object.assign(spy, { calls, flows });
}

const canvas = () => screen.getByRole('region', { name: 'Automation canvas' });
const drawer = () => screen.getByRole('region', { name: 'Test run' });
const codeJson = () => {
  fireEvent.click(screen.getByRole('tab', { name: /Code/ }));
  const value = JSON.parse((screen.getByLabelText('Flow definition JSON') as HTMLTextAreaElement).value);
  fireEvent.click(screen.getByRole('tab', { name: /Canvas/ }));
  return value;
};
const openTemplate = async (name: RegExp) => fireEvent.click(await screen.findByRole('button', { name }));
const runTest = async () => {
  fireEvent.click(screen.getByRole('button', { name: /^Test$/ }));
  await waitFor(() => expect(within(drawer()).queryByText(/Run a test to check/)).toBeNull());
};

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

// Long UI journeys (several simulated runs each); the default 5 s is too tight when the whole suite runs in parallel.
describe('Flows builder', { timeout: 20_000 }, () => {
  it('goes from a goal to a matched template on the canvas, tests it, and shows what blocks publishing', async () => {
    const api = fakeApi();
    render(<FlowsPage />);
    await screen.findByText('Vessel certificate reconciliation');

    fireEvent.change(screen.getByLabelText('What would you like to automate?'), { target: { value: 'chase overdue purchase orders with suppliers' } });
    fireEvent.click(screen.getByRole('button', { name: /Start building/ }));
    await screen.findByText(/Started from “Overdue purchase order follow-up”/);

    // The canvas draws the trigger and every step, and the goal goes to Copilot straight away.
    expect(within(canvas()).getByRole('button', { name: /Trigger: On a webhook call/ })).toBeTruthy();
    expect(within(canvas()).getByRole('button', { name: /Email supplier/ })).toBeTruthy();
    await screen.findByText('No change.');
    expect(api.calls.filter((c) => c.path.endsWith('/copilot')).map((c) => c.body.message)).toEqual(['chase overdue purchase orders with suppliers']);

    await runTest();
    expect(within(drawer()).getByText(/2 issue\(s\) would block publishing/)).toBeTruthy();
    expect(within(drawer()).getByText(/Would: Email "Follow-up on purchase order PO-2026-1187" to orders@nordic-chandlers\.example\.com/)).toBeTruthy();
    expect(within(drawer()).getByText(/No system was contacted/)).toBeTruthy();
    fireEvent.click(within(drawer()).getByRole('tab', { name: /Checks \(/ }));
    expect(within(screen.getByLabelText('Checks')).getAllByText(/connector:external/)).toHaveLength(2);
    // Findings are pinned to the steps on the canvas too.
    expect(within(canvas()).getAllByText(/1 blocking/).length).toBe(2);
  });

  it('shows a failure drill as a failed run with skipped downstream steps', async () => {
    fakeApi({ permissions: ['inspector:use', 'connector:write', 'connector:external'] });
    render(<FlowsPage />);
    await openTemplate(/Order status webhook to REST and alert/);
    fireEvent.click(screen.getByRole('button', { name: /Test run/ }));
    chooseSelectValue('Failure drill', 'fetch_order');
    fireEvent.click(screen.getByRole('button', { name: /Run test/ }));
    await screen.findByText(/The simulated run failed/);
    expect(screen.getByText('Failure drill: simulated outage')).toBeTruthy();
    expect(screen.getAllByText(/Skipped: step "fetch_order" failed/).length).toBe(3);
    expect(within(canvas()).getByLabelText('Test failed')).toBeTruthy();
  });

  it('lists validation issues for an invalid definition and keeps the canvas unavailable, not wrong, on bad JSON', async () => {
    fakeApi();
    render(<FlowsPage />);
    await openTemplate(/New starter onboarding/);
    fireEvent.click(screen.getByRole('tab', { name: /Code/ }));
    fireEvent.change(screen.getByLabelText('Flow definition JSON'), { target: { value: JSON.stringify({ name: 'x', steps: [{ id: 'a', type: 'shell', config: {} }] }) } });
    await runTest();
    expect(within(drawer()).getByText('The definition is not valid')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Flow definition JSON'), { target: { value: '{ nope' } });
    fireEvent.click(screen.getByRole('tab', { name: /Canvas/ }));
    expect(screen.getByText(/so the canvas and form are unavailable/)).toBeTruthy();
  });

  it('edits settings and steps from the side panel, and the policy check catches a removed approval', async () => {
    fakeApi({ permissions: ['inspector:use', 'connector:write', 'connector:external'] });
    render(<FlowsPage />);
    await openTemplate(/Overdue purchase order follow-up/);

    chooseSelectValue('Trigger', 'schedule');
    fireEvent.change(screen.getByLabelText('Schedule (cron, UTC)'), { target: { value: '0 6 * * 1' } });
    fireEvent.change(screen.getByLabelText('Budget per run (USD)'), { target: { value: '0.5' } });
    expect(within(canvas()).getByRole('button', { name: /Trigger: On a schedule/ })).toBeTruthy();

    fireEvent.click(within(canvas()).getByRole('button', { name: /Email supplier/ }));
    fireEvent.change(screen.getByLabelText('Retries'), { target: { value: '3' } });
    fireEvent.click(within(canvas()).getByRole('button', { name: /Buyer approves follow-up/ }));
    fireEvent.change(screen.getByLabelText('Approver email'), { target: { value: 'lead@example.com' } });

    // The code view shows exactly what the panel produced.
    const def = codeJson();
    expect(def.trigger).toEqual({ type: 'schedule', cron: '0 6 * * 1' });
    expect(def.budget).toEqual({ maxCostUsd: 0.5 });
    expect(def.steps.find((s: { id: string }) => s.id === 'email_supplier').retries).toBe(3);
    expect(def.steps.find((s: { id: string }) => s.id === 'approve_follow_up').config.assignee).toBe('lead@example.com');

    // Remove the approval: the server-side policy check now blocks the send.
    fireEvent.click(within(canvas()).getByRole('button', { name: /Buyer approves follow-up/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove approve_follow_up' }));
    expect(within(canvas()).queryByRole('button', { name: /Buyer approves follow-up/ })).toBeNull();
    await runTest();
    await screen.findByText(/would block publishing/);
    fireEvent.click(within(canvas()).getByRole('button', { name: /Email supplier/ }));
    expect(screen.getAllByText(/add an approval step before it/).length).toBeGreaterThan(0);
  });

  it('adds a step after another from the canvas and opens it for editing', async () => {
    fakeApi();
    render(<FlowsPage />);
    await openTemplate(/Overdue purchase order follow-up/);
    fireEvent.click(screen.getByRole('button', { name: 'Add a step after supplier' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Ask AI/ }));
    expect(screen.getByLabelText('Prompt')).toBeTruthy();
    const def = codeJson();
    const ids = def.steps.map((s: { id: string }) => s.id);
    expect(ids.indexOf('agent_1')).toBe(ids.indexOf('supplier') + 1);
    expect(def.steps[ids.indexOf('agent_1')].dependsOn).toEqual(['supplier']);
  });

  it('marks a test result out of date once the draft changes', async () => {
    fakeApi();
    render(<FlowsPage />);
    await openTemplate(/New starter onboarding/);
    await runTest();
    expect(within(drawer()).queryByText(/Out of date/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Name', { selector: '#flow-name' }), { target: { value: 'Changed' } });
    expect(within(drawer()).getByText(/Out of date: run again/)).toBeTruthy();
  });

  it('saves a template as a draft, saves a new version, and publishes it with the test data', async () => {
    const api = fakeApi({ permissions: ['inspector:use', 'connector:write', 'connector:external'] });
    render(<FlowsPage />);
    await openTemplate(/Order status webhook to REST and alert/);
    expect(screen.getByText('Not saved')).toBeTruthy();
    expect(screen.queryByText('Unsaved changes')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));
    await screen.findByText('Saved as version 1.');
    expect(api.calls.find((c) => c.method === 'POST' && c.path === '/api/agent-lab/flows')!.body.definition.name).toBe('Order status webhook to REST and alert');
    expect(screen.getByText('Draft · v1')).toBeTruthy();
    // Nothing to save until something changes.
    expect((screen.getByRole('button', { name: 'Save new version' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Name', { selector: '#flow-name' }), { target: { value: 'Order alerts' } });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    // Publishing an older saved version while editing is not offered.
    expect((screen.getByRole('button', { name: 'Publish v1' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save new version' }));
    await screen.findByText('Saved as version 2.');
    expect(api.calls.find((c) => c.path.endsWith('/versions'))!.body.baseVersion).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Publish v2' }));
    await screen.findByText('Version 2 is published.');
    const pub = api.calls.find((c) => c.path.endsWith('/publish') && c.method === 'POST')!.body;
    expect(pub.version).toBe(2);
    expect(Object.keys(pub.fixtures)).toEqual(['fetch_order']);
    expect(pub.inputs).toEqual(FLOW_TEMPLATES.find((t) => t.id === 'integration-order-webhook')!.sampleInputs);
    expect(screen.getByText('Published v2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unpublish' })).toBeTruthy();
  });

  it('edits a sample response per step and sends it with the test', async () => {
    const api = fakeApi();
    render(<FlowsPage />);
    await openTemplate(/Overdue purchase order follow-up/);
    fireEvent.click(within(canvas()).getByRole('button', { name: /Look up supplier/ }));
    const box = screen.getByLabelText('Sample response') as HTMLTextAreaElement;
    expect(box.value).toContain('Nordic Chandlers AS');
    fireEvent.change(box, { target: { value: '{"status":200,"body":{"name":"Baltic Supply","contact_email":"x@example.com"}}' } });
    fireEvent.blur(box);
    await runTest();
    expect(api.calls.find((c) => c.path.endsWith('/simulate'))!.body.fixtures.supplier.body.name).toBe('Baltic Supply');
  });

  it('reopens a saved automation from My automations and shows why publishing was refused', async () => {
    const def = JSON.parse(JSON.stringify(FLOW_TEMPLATES.find((t) => t.id === 'hr-new-starter-onboarding')!.definition));
    const api = fakeApi({
      flows: [{ id: 'f9', name: 'Onboarding', status: 'draft', version: 3, definition: def, owner: 'me', updatedAt: '2026-10-26T10:00:00Z' }],
      publishError: 'publishing needs permission "connector:external", which you do not have',
    });
    render(<FlowsPage />);
    fireEvent.click(await within(await screen.findByRole('region', { name: 'My automations' })).findByRole('button', { name: /Onboarding/ }));
    await waitFor(() => expect((screen.getByLabelText('Name', { selector: '#flow-name' }) as HTMLInputElement).value).toBe('New starter onboarding'));
    expect(screen.getByText('Draft · v3')).toBeTruthy();
    expect(screen.getByText('Saved')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Publish v3' }));
    await screen.findByText(/Not published: publishing needs permission "connector:external"/);
    expect(api.flows[0]!.status).toBe('draft');
  });

  it('tells the user when a save conflicts with a newer version', async () => {
    const def = FLOW_TEMPLATES[0]!.definition;
    const api = fakeApi({ flows: [{ id: 'f1', name: 'X', status: 'draft', version: 1, definition: def, owner: 'me', updatedAt: '2026-10-26T10:00:00Z' }] });
    render(<FlowsPage />);
    fireEvent.click(await within(await screen.findByRole('region', { name: 'My automations' })).findByRole('button', { name: /^X/ }));
    await screen.findByText('Draft · v1');
    fireEvent.change(screen.getByLabelText('Name', { selector: '#flow-name' }), { target: { value: 'Y' } });
    api.flows[0]!.version = 2; // someone else saved
    fireEvent.click(screen.getByRole('button', { name: 'Save new version' }));
    await screen.findByText(/changed elsewhere/);
  });

  it('previews a Copilot proposal on the canvas and changes the draft only when applied', async () => {
    fakeApi({
      copilot: (msg) =>
        /weekly/.test(msg)
          ? { reply: 'It now runs every Monday at 09:00 and summarises the result.', operations: [{ op: 'set_trigger', trigger: { type: 'schedule', cron: '0 9 * * 1' } }, { op: 'add_step', step: { id: 'summary', type: 'agent', name: 'Summarise outcome', dependsOn: ['record'], config: { prompt: 'Summarise {{steps.supplier.body.name}}' } } }] }
          : { reply: 'Removed the approval.', operations: [{ op: 'remove_step', id: 'approve_follow_up' }] },
    });
    render(<FlowsPage />);
    await openTemplate(/Overdue purchase order follow-up/);
    fireEvent.click(screen.getByRole('tab', { name: /Copilot/ }));

    fireEvent.change(screen.getByLabelText('Describe a change'), { target: { value: 'make it weekly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('It now runs every Monday at 09:00 and summarises the result.');
    expect(screen.getByText('Previewing Copilot’s proposal')).toBeTruthy();
    expect(within(canvas()).getByRole('button', { name: /Summarise outcome/ })).toBeTruthy();
    expect(within(canvas()).getByText('New')).toBeTruthy();
    expect(within(screen.getByLabelText('Proposed changes')).getByText('Runs on the schedule 0 9 * * 1 (UTC)')).toBeTruthy();
    // Not applied yet: the draft is unchanged.
    expect(codeJson().trigger.type).toBe('webhook');

    fireEvent.click(within(screen.getByLabelText('Proposed changes')).getByRole('button', { name: /Apply/ }));
    expect(screen.queryByText('Previewing Copilot’s proposal')).toBeNull();
    expect(screen.getByText('Applied to the draft')).toBeTruthy();
    const def = codeJson();
    expect(def.trigger).toEqual({ type: 'schedule', cron: '0 9 * * 1' });
    expect(def.steps.at(-1).id).toBe('summary');

    // A proposal that breaks a rule says so before it is applied, and can be discarded.
    fireEvent.click(screen.getByRole('tab', { name: /Copilot/ }));
    fireEvent.change(screen.getByLabelText('Describe a change'), { target: { value: 'skip the approval' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('This change would block publishing:');
    const card = within(screen.getAllByLabelText('Proposed changes').at(-1)!);
    expect(card.getByText(/add an approval step before it/)).toBeTruthy();
    // Findings the draft already had (two connector:external, and the budget overrun from the step applied above) are not presented as new.
    expect(card.getByText('3 issues that already blocked publishing remain.')).toBeTruthy();
    fireEvent.click(within(screen.getAllByLabelText('Proposed changes').at(-1)!).getByRole('button', { name: /Discard/ }));
    expect(within(canvas()).getByRole('button', { name: /Buyer approves follow-up/ })).toBeTruthy();
    expect(screen.getByText('Discarded')).toBeTruthy();
  });

  it('asks for a goal instead of doing nothing, and builds from scratch when no template is close', async () => {
    const api = fakeApi({ copilot: () => ({ reply: 'Added a first step.', operations: [{ op: 'add_step', step: { id: 'report', type: 'agent', name: 'Write the summary', config: { prompt: 'Summarise weekly sales' } } }] }) });
    render(<FlowsPage />);
    await screen.findByText('Vessel certificate reconciliation');
    fireEvent.click(screen.getByRole('button', { name: /Start building/ }));
    expect(screen.getByText(/Describe what you want to automate first/)).toBeTruthy();
    expect(api.calls.some((c) => c.path.endsWith('/copilot'))).toBe(false);

    fireEvent.change(screen.getByLabelText('What would you like to automate?'), { target: { value: 'zzz qqq' } });
    fireEvent.click(screen.getByRole('button', { name: /Start building/ }));
    await screen.findByText(/Copilot is building this from scratch/);
    await screen.findByText('Previewing Copilot’s proposal');
    expect(within(canvas()).getByRole('button', { name: /Write the summary/ })).toBeTruthy();
  });

  it('starts a blank workflow and explains when Copilot is not available', async () => {
    fakeApi({ copilot: () => ({ status: 503, error: 'The copilot needs a configured model backend on this server', code: 'copilot_unavailable' }) });
    render(<FlowsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Blank automation/ }));
    expect(screen.getByText('This automation has no steps yet')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Describe a change'), { target: { value: 'build me something' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('The copilot needs a configured model backend on this server');
    expect(screen.getByText(/Copilot is not available on this server/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add the first step' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Query data/ }));
    expect(within(canvas()).getByRole('button', { name: /^query_1, Query data/ })).toBeTruthy();
  });
});
