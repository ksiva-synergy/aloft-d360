import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDefaultOrg } from '@/lib/platform/agents';
import { getUserByEmail } from '@/lib/dashboards/permissions';
import {
  resolveGovernedModel,
  loadCatalog,
  scanConsumers,
  buildFocusedGraph,
  listFocusOptions,
  governanceSummary,
} from '@/lib/semantic/lineage';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inspector/semantic/lineage?focus=<nodeId>&q=<search>
 *
 * The Lineage graph — ONE graph, focus-SCOPED (the populated model has ~12k nodes,
 * so the whole graph is never serialized). Returns:
 *   - focusOptions: a light, searchable list of focusable nodes (measures + entities)
 *     — `q` filters, capped at 50 (hasMore flag). The two lenses: pick a metric
 *     (forward) or an entity (reverse).
 *   - focus: the bounded neighborhood subgraph of the resolved focus node. Nodes
 *     carry resolvesTo { fullPath, column|expression, resultAlias } (Pin #1); measures
 *     carry a read-only compiled-SQL peek via compileSemanticQuery (PURE, no execution);
 *     candidate propagation is a status rollup (Pin #3), rendered as state, never a 500.
 *   - edges: membership (entity→def), join (entity↔entity + join keys), consumes (def→dashboard).
 *
 * States:
 *   { status: 'no_governed_model' }  — nothing governed yet (explicit UX state)
 *   { status: 'ok', model, focusOptions, focus, omissions }
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = await getUserByEmail(email);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const org = await getDefaultOrg();

    const model = await resolveGovernedModel(org.id);
    if (!model) return NextResponse.json({ status: 'no_governed_model' as const });

    const cat = await loadCatalog(org.id, model.id);
    if (!cat) return NextResponse.json({ status: 'no_governed_model' as const });

    const url = new URL(request.url);
    const q = url.searchParams.get('q') ?? undefined;
    const requestedFocus = url.searchParams.get('focus') ?? undefined;

    const focusOptions = listFocusOptions(cat, { q });

    // Resolve the focus node: requested (if valid) else the first option.
    const validRequested =
      requestedFocus &&
      (focusOptions.options.some((o) => o.id === requestedFocus) ||
        // requested may be outside the q-filtered page — accept any real node id
        requestedFocus.startsWith('meas:') ||
        requestedFocus.startsWith('dim:') ||
        requestedFocus.startsWith('e:'));

    const focusId = validRequested ? requestedFocus! : focusOptions.options[0]?.id;

    const consumers = await scanConsumers(org.id);
    const focus = focusId ? buildFocusedGraph(cat, consumers, focusId) : null;

    return NextResponse.json({
      status: 'ok' as const,
      model,
      focusOptions,
      focus,
      omissions: focus?.omissions ?? [],
      // Bootstrap context travels with the cap counts (see governanceSummary):
      // a 99%-candidate estate is the expected state, not a broken lineage view.
      governance: governanceSummary(cat),
    });
  } catch (err) {
    console.error('[semantic/lineage GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
