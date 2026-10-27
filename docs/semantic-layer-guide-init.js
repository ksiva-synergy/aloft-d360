function initSemanticGuidePage(root) {
  if (!root || root.dataset.semGuideInit === '1') return;
  root.dataset.semGuideInit = '1';
  const semGet = (id) => root.querySelector('#' + id);
  window.__semActivateTab = (tab) => __semGuideActivateTab(tab);
  
    /* Must run before DOMContentLoaded — otherwise Mermaid auto-renders diagrams inside hidden tabs (0×0 SVGs). */
    if (typeof mermaid !== 'undefined') {
      mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
    }

    const GLOSSARY = [
      { term: 'Semantic layer', def: 'The set of official business metrics and dimensions your organization agrees on.', purpose: 'So everyone (and the AI) uses the same definitions for numbers.', example: 'One governed “Revenue” measure used by Inspector and dashboards.', advantage: 'Consistency and auditability.', not: 'Not the harvester, not raw Databricks tables.' },
      { term: 'Semantic model', def: 'A named bundle of entities, dimensions, measures, and joins in Aurora.', purpose: 'Scopes which tables and metrics belong together (e.g. marine ops).', example: 'Model id linked from dashboards and SemanticQuery.modelId.', advantage: 'Clear boundary for governance and lineage.', not: 'Not a Databricks database.' },
      { term: 'Entity', def: 'A physical table or view in the warehouse.', purpose: 'The FROM clause anchor for queries.', example: 'Entity “Inspections” → marine.gold.inspections.', advantage: 'Business label + synonyms separate from technical path.', not: 'Not a single column.' },
      { term: 'Dimension', def: 'An attribute you group or filter by.', purpose: 'Slice metrics (by flag, vessel, month).', example: 'Dimension “Flag” on column flag_code.', advantage: 'Typed (categorical, temporal) for better chart suggestions.', not: 'Not an aggregated number.' },
      { term: 'Measure', def: 'A metric you aggregate (sum, count, average, …).', purpose: 'The number users ask for in questions.', example: '“Open defect count” = COUNT(defect_id).', advantage: 'Central place for formula and unit.', not: 'Not a raw column unless simple aggregate maps 1:1.' },
      { term: 'Join', def: 'A declared relationship between two entities.', purpose: 'Lets the compiler build multi-table SQL safely.', example: 'Inspections JOIN vessels ON inspections.vessel_id = vessels.id.', advantage: 'Stewards control join logic once.', not: 'Not inferred automatically on every query without join rows.' },
      { term: 'SemanticQuery', def: 'JSON request listing model, entity, dimension IDs, measure IDs, filters.', purpose: 'Safe contract between AI/UI and compiler.', example: '{ entityId, measures: [{ measureId }], dimensions: [...] }', advantage: 'Validation before SQL hits Databricks.', not: 'Not free-text SQL.' },
      { term: 'Governed status', def: 'Official, production-ready definition.', purpose: 'Used by Inspector charts and published dashboards.', example: 'After successful POST /promote.', advantage: 'Trust in shared metrics.', not: 'Not the same as “table exists in warehouse”.' },
      { term: 'Draft status', def: 'Personal work-in-progress definition.', purpose: 'Let analysts experiment without affecting others.', example: 'Alex’s draft measure visible only to Alex in preview.', advantage: 'Safe sandbox.', not: 'Not visible in org review until submit.' },
      { term: 'Candidate status', def: 'Submitted for org visibility and review.', purpose: 'Bridge between private draft and official governed.', example: 'Shows in metrics catalog Govern lens.', advantage: 'Collaboration before promotion.', not: 'Not yet fully trusted for all production paths without model rules.' },
      { term: 'Promotion gate', def: 'Rules for who may promote candidate → governed.', purpose: 'Prevent low-trust users from defining official metrics.', example: 'streetCred ≥ 80 self-approve, else admin or quorum 120.', advantage: 'Ties to FOER reputation domain semantic_authoring.', not: 'Not applied on submit (submit is open to owner).' },
      { term: 'Harvester', def: 'ECS Fargate worker running scripts/context/orchestrator.ts over platform_context_jobs.', purpose: 'Fill Data Estate inventory for discovery and AI context.', example: 'Daily change_detect sweep + weekly T1 profile.', advantage: 'Keeps metadata fresh without manual spreadsheets.', not: 'Not the governed semantic layer (platform_sem_*).' },
      { term: 'T0 (structural)', def: 'Job kind t0_structural — mirror catalog.schema.table and columns from Databricks.', purpose: 'Authoritative inventory for everything downstream.', example: 'last_t0_at stamped on platform_context_objects.', advantage: 'Delta mode after first sweep saves warehouse queries.', not: 'Not profiling or LLM enrichment.' },
      { term: 'T1 (profile)', def: 'Job kind t1_profile — column stats and samples.', purpose: 'Ground truth for data quality and T2 prompts.', example: 'Top-k values on a status column before LLM describes it.', advantage: 'Stewards see null% and cardinality in Catalog.', not: 'Not business metric definitions.' },
      { term: 'T2 (semantic enrich)', def: 'Job kind t2_semantic — Bedrock-generated object cards and column semantic JSON.', purpose: 'Human-readable catalog and better embed/search text.', example: 'Grain, PII flags, FK candidates on marine.gold.inspections.', advantage: 'Feeds describe_schema and Mapper without typing every column.', not: 'Not governed measures — use semantic layer authoring.' },
      { term: 'embed job', def: 'Job kind embed — vectorize T2 text into platform_context_embeddings.', purpose: 'Semantic search in harvested catalog mode.', example: 'Inspector describe_schema search ranks by pgvector similarity.', advantage: 'Finds tables by meaning, not exact name match.', not: 'Not the same job as t3_usage (usage is separate).' },
      { term: 'T3 usage', def: 'Job kind t3_usage — query history + lineage analysis per source.', purpose: 'Capture real filters, joins, and hot columns.', example: 'Weekly aloft-t3-usage-weekly Fargate task.', advantage: 'T2 enrichment can reuse usage signals; stewards see how tables are used.', not: 'Not per-object reharvest-all (source-wide only).' },
      { term: 'T3 connected', def: 'Job kind t3_connected — planned cross-object connection analysis.', purpose: 'Would stamp relationship metadata beyond single-table usage.', example: 'Shown in Jobs UI pipeline group “Usage & Connections”.', advantage: 'Future richer graph for Mapper/lineage.', not: 'Not implemented in orchestrator.ts today.' },
      { term: 'T4 bootstrap', def: 'Three job kinds: t4_scan (coordinator) → t4_entity_propose (per schema) → t4_dim_propose (per table) writing platform_sem_* candidates.', purpose: 'Auto-seed semantic models from T2-enriched context objects.', example: 'See guide tab T4 bootstrap (deep dive) for scan/propose/create steps.', advantage: 'Bulk catalog without typing every measure.', not: 'Not governed until promote; handlers stubbed in this repo checkout.' },
      { term: 't4_scan', def: 'Source-wide T4 coordinator job with advisory lock.', purpose: 'Pick T2-ready tables and fan out entity-propose children per catalog.schema.', example: 'aloft-t4-semantic-bootstrap-weekly EventBridge rule.', advantage: 'Incremental via last_t4_at on context objects.', not: 'Does not write dims/measures itself.' },
      { term: 'last_t4_at', def: 'Timestamp on platform_context_objects when t4_dim_propose succeeded for that table.', purpose: 'Estate UI + incremental scan eligibility.', example: 'Harvest timeline T4 dot on object detail.', advantage: 'See which tables were modelled.', not: 'Not the same as governed status on sem rows.' },
      { term: 'buildSemanticContext', def: 'Server function that loads governed entity summaries for prompts.', purpose: 'Ground Inspector on official names.', example: 'Top 10 entities ranked by embedding similarity to connection.', advantage: 'Better NL answers without full schema dump.', not: 'Not a query executor.' },
      { term: 'nl_intent', def: 'Natural language phrase a metric answers.', purpose: 'Power intent search and disambiguation.', example: '“How many open defects per vessel?” on a measure row.', advantage: 'Links questions to definitions via embeddings.', not: 'Not the SQL expression.' },
      { term: 'emit_semantic_chart', def: 'Inspector tool that returns a chart from SemanticQuery.', purpose: 'Structured analytics output in chat.', example: 'Agent picks measure/dimension IDs then tool renders chart.', advantage: 'Governed path vs ad-hoc db_query.', not: 'Not raw SQL tool.' },
      { term: 'Guided blueprint', def: 'Stage 2 of the guided dashboard builder: a reviewable outline of 4–6 proposed charts for a ResolvedIntent.', purpose: 'Let users curate a dashboard storyboard before widgets execute.', example: 'POST /semantic/[modelId]/blueprint after resolve-intent.', advantage: 'Fast first layout with server-side id grounding.', not: 'Not a live dashboard or Inspector chat session.' },
      { term: 'ChartBlueprint', def: 'One proposed chart spec: title, measure/dimension ids, chart kind guess, rationale, grounding state.', purpose: 'Bridge between LLM proposal and widget SemanticQuery.', example: '“Accidents by root cause” with governed measure + dimension ids.', advantage: 'Labels ride beside ids — cards render without extra lookups.', not: 'Not a rendered chart or pinned widget yet.' },
      { term: 'propose_blueprint', def: 'Forced Bedrock tool that returns structured chart proposals for one dashboard intent.', purpose: 'Single-turn JSON output instead of free-form chat.', example: 'Model fills charts[]; route calls groundBlueprint on the result.', advantage: 'Schema-bound proposal.', not: 'Not trusted without blueprint-ground.ts.' },
      { term: 'ResolvedIntent', def: 'Stage-1 output: user topic + modelId + relevant field ids + per-term disambiguation state.', purpose: 'Bind one dashboard to one semantic model and resolved vocabulary.', example: 'Topic + matched “Open defects” measure id.', advantage: 'Intent never picks charts — only vocabulary.', not: 'Not the blueprint itself.' },
      { term: 'toAlias', def: 'Function that turns a label into a SQL column alias.', purpose: 'Stable keys in result rows for charts.', example: '“Open Defect Count” → open_defect_count.', advantage: 'Charts don’t break on spaces in labels.', not: 'Not the display label shown to users.' },
      { term: 'spinor_semantic', def: 'Optional Databricks schema for exported views.', purpose: 'Separate client data from app-generated metric views.', example: 'catalog.spinor_semantic.mv_inspections_revenue', advantage: 'Could expose metrics to external BI.', not: 'Not wired from UI today.' },
      { term: 'Metrics catalog', def: 'UI at /agent-lab/metrics for browsing and governing defs.', purpose: 'Single pane for stewards and analysts.', example: 'Govern lens + promote/archive actions.', advantage: 'Virtualized table + lineage drawer.', not: 'Not the harvester jobs page.' },
      { term: 'Lineage', def: 'Graph of what uses a semantic definition.', purpose: 'Impact analysis before changing a measure.', example: 'Dashboard widget references measure id → edge in graph.', advantage: 'See blast radius of edits.', not: 'Not UC lineage from Databricks.' },
      { term: 'Continuous improvement', def: 'Ongoing loop: use metrics → learn from disambiguation, edits, harvest, reputation → refine definitions.', purpose: 'Keep the catalog accurate as the business and warehouse evolve.', example: 'User picks correct measure from chips; steward adds synonym; re-promote after schema change.', advantage: 'Layer stays trustworthy without one big bang project.', not: 'Not automatic self-governance without stewards.' },
      { term: 'Disambiguation', def: 'When one word maps to several metrics, the agent asks the user to choose.', purpose: 'Prevent wrong governed id in charts.', example: '“Revenue” → chips for Net Revenue vs Gross Revenue.', advantage: 'Teaches the session which definition you mean.', not: 'Not a substitute for writing clear synonyms on measures.' },
      { term: 'forceDemotion', def: 'Editing a governed computation may drop status back to candidate.', purpose: 'Force re-review after formula changes.', example: 'Change SUM to AVG on a governed measure → candidate until re-promoted.', advantage: 'Production numbers cannot change silently.', not: 'Not applied to cosmetic synonym edits only.' },
      { term: 'authoring-preview', def: 'API that runs SemanticQuery in authoring mode.', purpose: 'Preview draft metrics before promote.', example: 'Define Metric panel “Run preview” button.', advantage: 'Stamped as draft in UI.', not: 'Not used for anonymous dashboard viewers.' },
      { term: 'SemanticDraftAccessError', def: 'Error when query references another user’s draft.', purpose: 'Security boundary for personal drafts.', example: '403 on authoring-preview if measure id is someone else’s draft.', advantage: 'Prevents data leaks via ID guessing.', not: 'Not thrown for governed measures.' },
    ];

    function renderGlossary(filter) {
      const q = (filter || '').toLowerCase();
      const html = GLOSSARY.filter(g => {
        if (!q) return true;
        const blob = (g.term + g.def + g.purpose + g.example).toLowerCase();
        return blob.includes(q);
      }).map(g => `
        <article class="def-block glossary-item">
          <h4>${esc(g.term)}</h4>
          <dl>
            <dt>Definition</dt><dd>${esc(g.def)}</dd>
            <dt>Purpose</dt><dd>${esc(g.purpose)}</dd>
            <dt>Example</dt><dd>${esc(g.example)}</dd>
            <dt>Advantage</dt><dd>${esc(g.advantage)}</dd>
            <dt>Not the same as</dt><dd>${esc(g.not)}</dd>
          </dl>
        </article>`).join('');
      semGet('sem-glossary-list').innerHTML = html || '<p class="muted">No terms match your search.</p>';
    }

    const LIB_MODULES = [
      { name: 'types.ts', path: 'src/lib/semantic/types.ts', role: 'SemanticQuery contract + validateSemanticQuery()' },
      { name: 'compiler.ts', path: 'src/lib/semantic/compiler.ts', role: 'SemanticQuery + model → Databricks SQL; compileSafety()' },
      { name: 'execute.ts', path: 'src/lib/semantic/execute.ts', role: 'Load model, filterAccessible, compile, executeDatabricksSQL' },
      { name: 'authoring-access.ts', path: 'src/lib/semantic/authoring-access.ts', role: 'draft vs governed visibility per execution mode' },
      { name: 'authoring-draft.ts', path: 'src/lib/semantic/authoring-draft.ts', role: 'Define Metric validation + preview + edit gates' },
      { name: 'governance.ts', path: 'src/lib/semantic/governance.ts', role: 'submit, promote, archive, audit, recalculateModelStatus' },
      { name: 'promotion-gate.ts', path: 'src/lib/semantic/promotion-gate.ts', role: 'streetCred 80; quorum 120; semantic_authoring' },
      { name: 'context-builder.ts', path: 'src/lib/semantic/context-builder.ts', role: 'Inspector prompt: governed entities + pgvector rank' },
      { name: 'intent-embed.ts', path: 'src/lib/semantic/intent-embed.ts', role: 'platform_nl_intent_embeddings upsert/delete' },
      { name: 'intent-match.ts', path: 'src/lib/semantic/intent-match.ts', role: 'Cosine match + governed intent listing' },
      { name: 'lineage.ts', path: 'src/lib/semantic/lineage.ts', role: 'Catalog, consumers, graph, governanceSummary' },
      { name: 'metric-views.ts', path: 'src/lib/semantic/metric-views.ts', role: 'DDL to spinor_semantic — not API-wired' },
      { name: 'errors.ts', path: 'src/lib/semantic/errors.ts', role: 'ValidationFailure, NotGoverned, DraftAccess' },
    ];

    const ACCESS_MATRIX = [
      { surface: 'Inspector chat / emit_semantic_chart', draft: 'Hidden', candidate: 'Yes if model governed', governed: 'Yes' },
      { surface: 'buildSemanticContext (LLM prompt)', draft: 'Governed entities; defs not filtered', candidate: 'Under governed entity', governed: 'Yes' },
      { surface: 'authoring-preview / Define Metric', draft: 'Own drafts only', candidate: 'Yes', governed: 'Yes' },
      { surface: 'GET /definitions', draft: 'Hidden', candidate: 'Shown', governed: 'Shown' },
      { surface: 'GET /review', draft: 'Hidden', candidate: 'Shown', governed: 'Shown' },
      { surface: 'Dashboard batch /data', draft: 'No', candidate: 'Yes if model governed', governed: 'Yes' },
      { surface: 'verify_claim (reflect-tools)', draft: 'No', candidate: 'Governed model only', governed: 'Yes' },
    ];

    const AUTHORING_DECISIONS = [
      ['archived', 'any', 'any', 'any', 'exclude'],
      ['candidate | governed', 'any', 'any', 'any', 'allow'],
      ['draft', 'false', 'any', 'any', 'exclude'],
      ['draft', 'true', 'caller', 'any', 'allow'],
      ['draft', 'true', 'other', 'yes', 'forbid → SemanticDraftAccessError'],
      ['draft', 'true', 'other', 'no', 'exclude (not in query)'],
    ];

    const SCENARIOS = [
      { title: 'Analyst asks a governed question in Inspector', steps: [
        'User types a question in Inspector with a Databricks connection selected.',
        'Server loads buildSemanticContext — short list of official entities/measures for the prompt.',
        'LLM chooses governed measure/dimension IDs (or asks user to disambiguate).',
        'Tool emit_semantic_chart sends SemanticQuery JSON (not raw SQL).',
        'chart-pipeline verifies model is governed and IDs are not draft/archived.',
        'executeSemanticQuery compiles SQL, runs on Databricks, returns rows for the chart.',
      ]},
      { title: 'Steward defines a new metric (Phase 3.5B)', steps: [
        'DefineMetricPanel → GET …/authoring-meta.',
        'POST …/drafts → status=draft, created_by=user.',
        'nl_intent → upsertIntentEmbedding.',
        'POST …/authoring-preview with session authoringUserId.',
        'POST …/submit → candidate.',
        'POST …/promote → evaluatePromotionEligibility.',
        'writeAuditRow + creditAuthoringPromotion if MEMORY_REPUTATION_ENABLED.',
      ]},
      { title: 'T4 bootstrap run (when handlers are deployed)', steps: [
        'Prerequisite: T2 semantic enrich completed for target tables (last_t2_at set).',
        'Launch t4_scan (weekly schedule or Jobs UI) — coordinator acquires org lock.',
        'scanEstate(minT2=true) selects objects; enqueues t4_entity_propose per catalog.schema.',
        'Each entity propose: Bedrock creates platform_sem_entities + joins; enqueues t4_dim_propose per table.',
        'Each dim propose: writes platform_sem_dimensions/measures (candidate, created_by NULL); stamps last_t4_at.',
        'Optional: GET /api/inspector/digest for run summary; stewards promote model and selected defs to governed.',
      ]},
      { title: 'Dashboard widget uses semantic binding', steps: [
        'GET …/definitions (governed model; no drafts in picker).',
        'Widget stores SemanticQuery in spec JSON.',
        'Editor preview may use authoring opts; viewers cannot.',
        'GET …/dashboards/[id]/data batch execute, no authoring bypass.',
        'lineage scanConsumers from widget measure IDs.',
      ]},
    ];

    const API_ROUTES = [
      { route: '/api/inspector/semantic/models', method: 'GET', auth: 'Session', guards: '401 if no user; defaultModelId = latest governed else candidate', file: 'semantic/models/route.ts' },
      { route: '/api/inspector/semantic/candidates', method: 'GET', auth: 'None (org default)', guards: 'Latest candidate model for Inspector Semantic tab', file: 'semantic/candidates/route.ts' },
      { route: '/api/inspector/semantic/my-drafts', method: 'GET', auth: 'Session', guards: 'Owner-scoped drafts org-wide', file: 'semantic/my-drafts/route.ts' },
      { route: '/api/inspector/semantic/my-contributions', method: 'GET', auth: 'Session', guards: 'Audit-based contribution feed', file: 'semantic/my-contributions/route.ts' },
      { route: '/api/inspector/semantic/lineage', method: 'GET', auth: 'Session', guards: '401; no_governed_model or graph JSON', file: 'semantic/lineage/route.ts' },
      { route: '/api/inspector/semantic/entities-catalog', method: 'GET', auth: 'Session', guards: 'Paginated governed catalog', file: 'semantic/entities-catalog/route.ts' },
      { route: '/api/inspector/semantic/[modelId]/definitions', method: 'GET', auth: 'Org default', guards: '404 unless model governed; hides draft/archived', file: 'semantic/[modelId]/definitions/route.ts' },
      { route: '/api/inspector/semantic/[modelId]/review', method: 'GET', auth: 'Org default', guards: '404 if model missing; excludes draft', file: 'semantic/[modelId]/review/route.ts' },
      { route: '/api/inspector/semantic/[modelId]/drafts', method: 'GET/POST', auth: 'Session', guards: 'POST: 403 other-user entity; 409 dup dimension', file: 'semantic/[modelId]/drafts/route.ts' },
      { route: '/api/inspector/semantic/[modelId]/submit', method: 'POST', auth: 'Session', guards: 'Owner only; T4 rows cannot submit', file: 'semantic/[modelId]/submit/route.ts' },
      { route: '/api/inspector/semantic/[modelId]/promote', method: 'POST', auth: 'Session', guards: '403 promotion gate; 400 draft without submit', file: 'semantic/[modelId]/promote/route.ts' },
      { route: '/api/inspector/semantic/[modelId]/archive', method: 'POST', auth: 'Session', guards: 'Admin any; non-admin own drafts only', file: 'semantic/[modelId]/archive/route.ts' },
      { route: '/api/inspector/semantic/[modelId]/definitions/[id]', method: 'PATCH', auth: 'Session', guards: 'decideEditGate; may demote', file: '.../definitions/[definitionId]/route.ts' },
      { route: '/api/inspector/semantic/[modelId]/authoring-meta', method: 'GET', auth: 'Session', guards: 'Define Metric entities/defs', file: 'semantic/[modelId]/authoring-meta/route.ts' },
      { route: '/api/inspector/semantic/[modelId]/authoring-preview', method: 'POST', auth: 'Session', guards: '403 DraftAccess; 503 no DBX', file: 'semantic/[modelId]/authoring-preview/route.ts' },
      { route: '/api/inspector/semantic/[modelId]/resolve-intent', method: 'POST', auth: 'Org default', guards: '404 if model not governed', file: 'semantic/[modelId]/resolve-intent/route.ts' },
      { route: '/api/inspector/semantic/[modelId]/intents', method: 'GET', auth: 'Org default', guards: 'Governed NL intents', file: 'semantic/[modelId]/intents/route.ts' },
      { route: '/api/inspector/semantic/[modelId]/disambiguation-rank', method: 'POST', auth: 'Optional session', guards: 'Ranks candidates', file: 'semantic/[modelId]/disambiguation-rank/route.ts' },
      { route: '/api/inspector/semantic/[modelId]/blueprint', method: 'POST', auth: 'Org default', guards: 'propose_blueprint + catalog grounding', file: 'semantic/[modelId]/blueprint/route.ts' },
      { route: '/api/inspector/semantic/[modelId]/blueprint/refine-item', method: 'POST', auth: 'Org default', guards: 'Refine blueprint item', file: '.../blueprint/refine-item/route.ts' },
      { route: '/api/inspector/semantic/[modelId]/contributions', method: 'GET', auth: 'Session', guards: 'Per-model history', file: 'semantic/[modelId]/contributions/route.ts' },
      { route: '/api/agent-lab/context/objects/[id]/confirm-semantic', method: 'POST', auth: 'Session', guards: 'Estate card trust; 409 VERSION_SUPERSEDED', file: 'confirm-semantic/route.ts' },
      { route: '/api/inspector/digest', method: 'GET', auth: 'Org default', guards: '404 if no succeeded t4_scan; payload + narrative + charts', file: 'inspector/digest/route.ts' },
      { route: '/api/agent-lab/context/jobs/launch', method: 'POST', auth: 'Session', guards: 'Can launch t4_scan among VALID_KINDS', file: 'context/jobs/launch/route.ts' },
      { route: '/api/inspector/dashboards/[dashboardId]/data', method: 'POST', auth: 'Session', guards: 'Batch execute; no authoring bypass', file: 'dashboards/.../data/route.ts' },
    ];

    const MODE_TEXT = {
      default: 'Default path: model must be governed; filterAccessible excludes all drafts; candidate + governed defs allowed.',
      authoring: 'isAuthoringExecution requires BOTH authoringMode AND authoringUserId. Model status gate bypassed. Own drafts allowed in query.',
      'dashboard-view': 'dashboards/.../data and viewer preview: no authoring bypass; model must be governed; drafts never execute.',
    };

    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function fillTable(tbody, rows, cols) {
      tbody.innerHTML = rows.map(row => {
        const cells = cols ? cols(row) : row;
        return '<tr>' + cells.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>';
      }).join('');
    }

    root.querySelector('#sem-lib-modules-table tbody').innerHTML = LIB_MODULES.map(m =>
      '<tr><td><code>' + esc(m.name) + '</code></td><td><code>' + esc(m.path) + '</code></td><td>' + esc(m.role) + '</td></tr>'
    ).join('');

    fillTable(root.querySelector('#sem-access-matrix-table tbody'), ACCESS_MATRIX, r => [r.surface, r.draft, r.candidate, r.governed]);
    fillTable(root.querySelector('#sem-authoring-decisions-table tbody'), AUTHORING_DECISIONS);

    renderGlossary('');
    semGet('sem-glossary-search').addEventListener('input', e => renderGlossary(e.target.value));

    semGet('sem-scenarios-container').innerHTML = SCENARIOS.map(s => {
      const steps = s.steps.map((st, i) => '<li>' + esc(st) + '</li>').join('');
      return '<details><summary>' + esc(s.title) + '</summary><ol>' + steps + '</ol></details>';
    }).join('');

    function renderApis() {
      const q = semGet('sem-api-search').value.toLowerCase();
      const authOnly = semGet('sem-api-auth-only').checked;
      const filtered = API_ROUTES.filter(r => {
        if (authOnly && r.auth !== 'Session' && !r.auth.startsWith('Session')) return false;
        if (!q) return true;
        return (r.route + r.guards + r.method).toLowerCase().includes(q);
      });
      semGet('sem-api-count').textContent = 'Showing ' + filtered.length + ' of ' + API_ROUTES.length + ' routes.';
      fillTable(root.querySelector('#sem-api-table tbody'), filtered, r => [r.method, r.route, r.auth, r.guards, r.file]);
    }
    semGet('sem-api-search').addEventListener('input', renderApis);
    semGet('sem-api-auth-only').addEventListener('change', renderApis);
    renderApis();

    function updateAccessMode() {
      const v = semGet('sem-access-mode').value;
      semGet('sem-access-mode-detail').textContent = MODE_TEXT[v] || '';
    }
    semGet('sem-access-mode').addEventListener('change', updateAccessMode);
    updateAccessMode();

    const T4_BLOCKS = {
      databricks: {
        title: '① Databricks warehouse',
        purpose: 'The real data: tables and columns in your lakehouse. T0 and T1 run SQL here to discover structure and profiles.',
        how: ['T0: DESCRIBE / information_schema → paths and column types.', 'T1: sample queries → null %, top values.', 'T4 does not copy warehouse rows into platform_sem_* — only metadata in Aurora.'],
        sample: 'Row (illustrative): user_id=usr_1042, is_active=true\nPath: current_db.drifter.process_flow_log_user',
        atlas: '#sample-warehouse',
      },
      'context-catalog': {
        title: '② Context catalog (platform_context_*)',
        purpose: 'Harvested inventory and AI descriptions — what Inspector “catalog mode” searches. Input to T4.',
        how: ['platform_context_objects: one row per table, last_t0_at … last_t4_at stamps.', 'platform_context_columns: semantic JSON from T2.', 'embed job writes platform_context_embeddings for search.'],
        sample: 'full_path: current_db.drifter.process_flow_log_user\nlast_t2_at: set (required for T4)\nlast_t4_at: set after dim propose',
        atlas: '#sample-context',
      },
      t0: {
        title: 'T0 structural harvest',
        purpose: 'Mirror table/column inventory from Databricks into Aurora — foundation for T1–T4 and Inspector harvested mode.',
        how: [
          'Job kind: t0_structural (orchestrator → runT0Harvest in harvest.ts).',
          'Reads: platform_context_sources, platform_databricks_connections; SQL via DatabricksAdapter.',
          'Writes: platform_context_objects (last_t0_at), platform_context_columns; sync platform_estate_objects.',
          'Full sweep: lifecycle dropped for missing tables; updates source last_sweep_at (not on includePatterns-only runs).',
          'UI: Sources “Harvest Now” queues only; Reharvest All enqueues + launches worker.',
          'Does not: profile, LLM, embed, usage, or platform_sem_*.',
        ],
        sample: 'job_kind: t0_structural\nscope: { "path": "cat.schema.table" }\n\nChained launch:\nscope.chain: ["t1_profile","t2_semantic","embed"]',
        atlas: 'context-harvesting-guide.html#step-t0-deep',
      },
      t1: { title: 'T1 profile', purpose: 'Column statistics and samples for stewards and LLM prompts.', how: ['Job: t1_profile.', 'Stores profile JSON on columns.', 'Sets last_t1_at.'], sample: 'Top values on is_active: true (607), false (412)', atlas: '' },
      t2: { title: 'T2 semantic enrich', purpose: 'Bedrock-generated business descriptions and column roles.', how: ['Job: t2_semantic in enrich.ts.', 'Object “card” + column semantic field.', 'Gate: T4 scan requires last_t2_at.'], sample: 'semantic.role: dimension\nsemantic.description: Whether the user record is active…', atlas: '#sample-context-col' },
      't4-pipeline': {
        title: '③ T4 bootstrap (three jobs)',
        purpose: 'Auto-build semantic layer candidates from the context catalog using Bedrock.',
        how: ['t4_scan: pick tables, enqueue per schema.', 't4_entity_propose: entities + joins.', 't4_dim_propose: dimensions + measures per table.'],
        sample: 'Job tree: scan → entity_propose → dim_propose\nSee atlas D for full job rows',
        atlas: '#sample-jobs',
      },
      't4-scan': {
        title: 't4_scan (coordinator)',
        purpose: 'One run per org/source: find T2-ready tables and fan out child jobs.',
        how: ['Advisory lock ctx-orch:{orgId}:t4_scan.', 'scanEstate(..., minT2=true).', 'Groups by catalog.schema → t4_entity_propose.', 'May ensure platform_semantic_models exists.'],
        sample: 'stats: { "clusters_enqueued": 12, "tables_total": 487 }',
        atlas: '#sample-jobs',
      },
      't4-entity-propose': {
        title: 't4_entity_propose',
        purpose: 'Per schema cluster: propose business entities and joins between tables.',
        how: ['scope: cluster_catalog, cluster_schema.', 'INSERT platform_sem_entities (candidate, created_by NULL).', 'INSERT platform_sem_joins.', 'Enqueue t4_dim_propose per table.'],
        sample: 'entity_label: Process Flow Log User\nfull_path: current_db.drifter.process_flow_log_user',
        atlas: '#sample-entity',
      },
      't4-dim-propose': {
        title: 't4_dim_propose',
        purpose: 'Per table: propose dimensions and measures from T2 + profiles.',
        how: ['scope.context_object_id → platform_context_objects.id.', 'INSERT platform_sem_dimensions / platform_sem_measures.', 'Sets last_t4_at on context object.'],
        sample: 'Dim: Is Active → is_active (categorical)\nMeasure: Distinct Users → user_id (hllp)',
        atlas: '#sample-dims',
      },
      bedrock: {
        title: 'AWS Bedrock (LLM)',
        purpose: 'Generates proposed labels, types, aggregates — not executed SQL for end users.',
        how: ['Used in T2 enrich and T4 entity/dim propose.', 'Sonnet-class model in Fargate task.', '~$0.003/table warning in Jobs UI.'],
        sample: 'Input: T2 card + column list + profile top-k\nOutput: Zod-validated JSON → Aurora rows',
        atlas: '',
      },
      'semantic-layer': {
        title: '④ Semantic layer (platform_sem_*)',
        purpose: 'Official metric definitions: entities, dimensions, measures, joins — compiled to SQL.',
        how: ['platform_semantic_models: container (e.g. Auto-Bootstrap Model).', 'Unique (model_id, full_path) per entity.', 'status: candidate until promote → governed.'],
        sample: 'model: Auto-Bootstrap Model, source_type=auto_bootstrap\n697 entities typical after bulk T4',
        atlas: '#sample-model',
      },
      'sem-model': { title: 'platform_semantic_models', purpose: 'Top-level bundle for dashboards and Inspector.', how: ['Entities page requires model status=governed.', 'source_type auto_bootstrap from T4.'], sample: 'name: Auto-Bootstrap Model\nstatus: governed (after promote)', atlas: '#sample-model' },
      'sem-entities': { title: 'platform_sem_entities + dims/measures', purpose: 'Business view of one warehouse table and its metrics.', how: ['full_path ties to context catalog.', 'SemanticQuery references measure/dimension IDs.', 'Compiler builds SQL.'], sample: 'See entities-catalog API fragment in atlas L', atlas: '#sample-api' },
      'stewards-promote': {
        title: 'Stewards promote',
        purpose: 'Turn trusted candidates into governed production definitions.',
        how: ['T4 rows: created_by NULL → use POST …/promote (not Submit).', 'Promotion gate: streetCred / admin.', 'platform_sem_audit records change.'],
        sample: 'action: promote\ncandidate → governed on platform_sem_measures',
        atlas: '#sample-audit',
      },
      'production-use': {
        title: '⑤ Inspector & dashboards',
        purpose: 'Consume governed SemanticQuery — not raw T4 candidates in production charts.',
        how: ['emit_semantic_chart tool.', 'GET entities-catalog for Estate UI.', 'Dashboard batch /data executes compiler.'],
        sample: 'SemanticQuery: modelId + entityId + measureIds + dimensionIds',
        atlas: '#sample-query',
      },
      'inspector-apps': { title: 'Inspector and dashboards', purpose: 'End-user analytics on governed metrics.', how: ['chart-pipeline checks governed model.', 'Draft/archived IDs excluded for viewers.'], sample: 'User asks: “distinct users by month” → governed measure IDs', atlas: '#sample-query' },
      eb: { title: 'EventBridge schedule', purpose: 'Weekly automatic t4_scan (aloft-t4-semantic-bootstrap-weekly).', how: ['Sunday 08:00 UTC in infra template.', 'Starts ECS task with --kind t4_scan.'], sample: 'cron(0 8 ? * SUN *)', atlas: '' },
      ui: { title: 'Agent Lab Jobs UI', purpose: 'Manual on-demand harvest and T4 launch.', how: ['Run T4 Entity Scan button.', 'Shows job tree and stats.'], sample: 'Jobs → T4 Entity Scan → confirm cost warning', atlas: '' },
      api: { title: 'jobs launch API', purpose: 'POST /api/agent-lab/context/jobs/launch enqueues work.', how: ['VALID_KINDS includes t4_scan.', 'Spawns Fargate via launchHarvesterTask.'], sample: 'body: { kind: "t4_scan" }', atlas: '' },
      ecs: { title: 'ECS Fargate harvester', purpose: 'Runs orchestrator.ts in container aloft-context-harvester.', how: ['Reads DATABASE_URL, Databricks creds.', 'Claims jobs from platform_context_jobs.'], sample: 'npx tsx scripts/context/orchestrator.ts --kind t4_scan', atlas: '' },
      orch: { title: 'orchestrator.ts', purpose: 'Dispatches job_kind to handlers; T4 stubbed in this repo checkout.', how: ['switch(job_kind) for t4_scan / entity / dim.', 'advanceChain for T0→T1→T2 pipelines.', 'Advisory lock on t4_scan entry.'], sample: 'Missing: t4-handlers.ts → jobs fail until ported', atlas: '' },
      queue: { title: 'platform_context_jobs', purpose: 'Queue + parent_job_id tree for fan-out.', how: ['Statuses: queued, running, succeeded, failed.', 'stats JSON on each job for digest API.'], sample: 'parent: scan id → children entity_propose → dim_propose', atlas: '#sample-jobs' },
      aurora: { title: 'Aurora PostgreSQL', purpose: 'Stores both context catalog and semantic layer.', how: ['Prisma from Next.js and harvester.', 'Same DB for platform_context_* and platform_sem_*.'], sample: 'DATABASE_URL in Beanstalk + Fargate task', atlas: '' },
      'gov-candidate': { title: 'T4 candidate rows', purpose: 'Bulk proposals — visible but not production-trusted.', how: ['created_by NULL.', 'Thousands after bootstrap run.'], sample: 'status: candidate on entity/dim/measure', atlas: '#sample-dims' },
      'gov-review': { title: 'Steward review', purpose: 'Entities page + Metrics catalog lenses.', how: ['Browse candidate badges.', 'Promote selected defs.'], sample: 'Entities UI: Process Flow Log User (Candidate)', atlas: '#sample-api' },
      'gov-promote': { title: 'POST promote', purpose: 'candidate → governed with gate and audit.', how: ['promotion-gate.ts streetCred 80 or quorum.', 'writeAuditRow.'], sample: 'POST …/semantic/[modelId]/promote', atlas: '#sample-audit' },
      'gov-governed': { title: 'Governed definitions', purpose: 'Official metrics for SQL compilation.', how: ['Inspector emit_semantic_chart uses these IDs.', 'forceDemotion on risky edits.'], sample: 'status: governed on Distinct Users measure', atlas: '#sample-meas' },
    };

    const T4_MERMAID_ID = {
      TBL: 'databricks', T0: 't0', T1: 't1', T2: 't2', PCO: 'context-catalog',
      SCAN: 't4-scan', EP: 't4-entity-propose', EP1: 't4-entity-propose', EP2: 't4-entity-propose',
      DP: 't4-dim-propose', DP1: 't4-dim-propose', DP2: 't4-dim-propose', DP3: 't4-dim-propose',
      BR: 'bedrock', MODEL: 'sem-model', ENT: 'sem-entities', ST: 'stewards-promote', APP: 'inspector-apps',
      EB: 'eb', UI: 'ui', API: 'api', ECS: 'ecs', ORCH: 'orch', Q: 'queue', AUR: 'aurora',
      G_CAND: 'gov-candidate', G_REV: 'gov-review', G_PROM: 'gov-promote', G_GOV: 'gov-governed', G_USE: 'production-use',
    };

    const T4_TEXT_KEYS = [
      ['platform_context_objects', 'context-catalog'],
      ['t4_scan', 't4-scan'],
      ['t4_entity_propose', 't4-entity-propose'],
      ['t4_dim_propose', 't4-dim-propose'],
      ['Bedrock', 'bedrock'],
      ['platform_semantic', 'sem-model'],
      ['entities dimensions', 'sem-entities'],
      ['Stewards promote', 'stewards-promote'],
      ['Inspector and dashboards', 'inspector-apps'],
      ['T0 structural', 't0'],
      ['T1 profile', 't1'],
      ['T2 semantic', 't2'],
      ['Tables and columns', 'databricks'],
      ['orchestrator', 'orch'],
      ['EventBridge', 'eb'],
      ['Agent Lab', 'ui'],
      ['jobs launch', 'api'],
      ['Fargate', 'ecs'],
      ['platform_context_jobs', 'queue'],
      ['Aurora PostgreSQL', 'aurora'],
      ['Context row', 'context-catalog'],
      ['platform_sem tables', 'sem-entities'],
      ['CANDIDATE rows', 'gov-candidate'],
      ['Stewards review', 'gov-review'],
      ['POST promote', 'gov-promote'],
      ['GOVERNED defs', 'gov-governed'],
      ['Inspector charts', 'production-use'],
    ];

    let t4HoverBlockId = null;

    function ensureT4TooltipEl() {
      let tip = semGet('t4-hover-tooltip');
      if (tip) return tip;
      tip = document.createElement('div');
      tip.id = 't4-hover-tooltip';
      tip.className = 't4-hover-tooltip';
      tip.hidden = true;
      tip.setAttribute('role', 'tooltip');
      tip.innerHTML =
        '<span class="tip-title"></span>' +
        '<p class="tip-purpose"></p>' +
        '<p class="tip-how"></p>' +
        '<span class="tip-hint">Click for full details</span>';
      root.appendChild(tip);
      return tip;
    }

    function hideT4HoverTip() {
      const tip = semGet('t4-hover-tooltip');
      if (tip) {
        tip.classList.remove('visible');
        tip.hidden = true;
      }
      t4HoverBlockId = null;
    }

    function moveT4HoverTip(ev) {
      const tip = semGet('t4-hover-tooltip');
      if (!tip || tip.hidden) return;
      const pad = 16;
      let x = ev.clientX + pad;
      let y = ev.clientY + pad;
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
      const rect = tip.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) {
        x = Math.max(8, ev.clientX - rect.width - pad);
        tip.style.left = x + 'px';
      }
      if (rect.bottom > window.innerHeight - 8) {
        y = Math.max(8, ev.clientY - rect.height - pad);
        tip.style.top = y + 'px';
      }
    }

    function showT4HoverTip(blockId, ev) {
      const data = T4_BLOCKS[blockId];
      if (!data) {
        hideT4HoverTip();
        return;
      }
      const tip = ensureT4TooltipEl();
      tip.querySelector('.tip-title').textContent = data.title;
      tip.querySelector('.tip-purpose').textContent = data.purpose;
      const howEl = tip.querySelector('.tip-how');
      if (data.how && data.how.length) {
        howEl.textContent = '• ' + data.how[0];
        howEl.style.display = 'block';
      } else {
        howEl.textContent = '';
        howEl.style.display = 'none';
      }
      tip.hidden = false;
      requestAnimationFrame(() => {
        tip.classList.add('visible');
        moveT4HoverTip(ev);
      });
      t4HoverBlockId = blockId;
    }

    function resolveT4BlockFromMermaidEvent(ev, wrap) {
      const node = ev.target.closest
        ? ev.target.closest('g.node, g.actor, g.labelGroup, .messageText, .note, g.cluster')
        : null;
      if (!node || !wrap.contains(node)) return null;
      const nodeId = node.id || '';
      const m = nodeId.match(/flowchart-([A-Za-z0-9_]+)-/);
      if (m && T4_MERMAID_ID[m[1]]) return T4_MERMAID_ID[m[1]];
      const seqM = nodeId.match(/sequence-(\d+)/);
      if (seqM) {
        const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
        for (let i = 0; i < T4_TEXT_KEYS.length; i++) {
          if (text.indexOf(T4_TEXT_KEYS[i][0]) !== -1) return T4_TEXT_KEYS[i][1];
        }
      }
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      for (let i = 0; i < T4_TEXT_KEYS.length; i++) {
        if (text.indexOf(T4_TEXT_KEYS[i][0]) !== -1) return T4_TEXT_KEYS[i][1];
      }
      return null;
    }

    function renderT4Block(blockId) {
      hideT4HoverTip();
      const data = T4_BLOCKS[blockId];
      const panel = semGet('sem-t4-detail-panel');
      if (!data || !panel) return;
      panel.classList.remove('empty');
      root.querySelectorAll('.arch-layer.clickable').forEach((el) => {
        el.classList.toggle('active-layer', el.getAttribute('data-t4-block') === blockId);
      });
      root.querySelectorAll('#sem-t4-quick-picks button').forEach((btn) => {
        btn.classList.toggle('sem-tab-active', btn.getAttribute('data-t4-block') === blockId);
      });
      const atlasLink = data.atlas
        ? '<p class="diagram-caption" style="margin-top:0.75rem"><a href="' + data.atlas + '">Open sample in data atlas →</a></p>'
        : '';
      panel.querySelector('.t4-detail-body').innerHTML =
        '<h3 class="t4-detail-title">' + esc(data.title) + '</h3>' +
        '<div class="t4-detail-section"><h4>Purpose</h4><p>' + esc(data.purpose) + '</p></div>' +
        '<div class="t4-detail-section"><h4>How it works</h4><ol>' +
        data.how.map((s) => '<li>' + esc(s) + '</li>').join('') +
        '</ol></div>' +
        '<div class="t4-detail-section"><h4>Sample</h4><div class="t4-detail-sample">' + esc(data.sample) + '</div></div>' +
        atlasLink;
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function initT4QuickPicks() {
      const wrap = semGet('sem-t4-quick-picks');
      if (!wrap || wrap.dataset.bound) return;
      wrap.dataset.bound = '1';
      ['t4-scan', 't4-entity-propose', 't4-dim-propose', 'context-catalog', 'semantic-layer', 'stewards-promote'].forEach((id) => {
        const b = T4_BLOCKS[id];
        if (!b) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-t4-block', id);
        btn.textContent = b.title.replace(/^[①-⑤]\s*/, '').slice(0, 28);
        btn.title = b.purpose;
        btn.addEventListener('click', () => renderT4Block(id));
        btn.addEventListener('mouseenter', (ev) => showT4HoverTip(id, ev));
        btn.addEventListener('mousemove', (ev) => {
          if (t4HoverBlockId === id) moveT4HoverTip(ev);
        });
        btn.addEventListener('mouseleave', () => hideT4HoverTip());
        wrap.appendChild(btn);
      });
    }

    function bindT4ArchLayers() {
      root.querySelectorAll('.arch-layer.clickable').forEach((el) => {
        if (el.dataset.bound) return;
        el.dataset.bound = '1';
        const id = el.getAttribute('data-t4-block');
        const activate = () => { if (id) renderT4Block(id); };
        el.addEventListener('click', activate);
        el.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); activate(); }
        });
        if (id && T4_BLOCKS[id]) {
          el.setAttribute('aria-label', T4_BLOCKS[id].title + ': ' + T4_BLOCKS[id].purpose);
        }
        el.addEventListener('mouseenter', (ev) => { if (id) showT4HoverTip(id, ev); });
        el.addEventListener('mousemove', (ev) => {
          if (id && t4HoverBlockId === id) moveT4HoverTip(ev);
        });
        el.addEventListener('mouseleave', () => hideT4HoverTip());
      });
    }

    function bindT4MermaidClicks() {
      const t4Panel = semGet('sem-panel-t4');
      if (!t4Panel) return;
      t4Panel.querySelectorAll('.mermaid-wrap').forEach((wrap) => {
        if (wrap.dataset.t4ClickBound) return;
        wrap.dataset.t4ClickBound = '1';
        wrap.addEventListener('click', (ev) => {
          const blockId = resolveT4BlockFromMermaidEvent(ev, wrap);
          if (blockId) renderT4Block(blockId);
        });
        wrap.addEventListener('mousemove', (ev) => {
          const blockId = resolveT4BlockFromMermaidEvent(ev, wrap);
          if (blockId) {
            if (blockId !== t4HoverBlockId) showT4HoverTip(blockId, ev);
            else moveT4HoverTip(ev);
          } else {
            hideT4HoverTip();
          }
        });
        wrap.addEventListener('mouseleave', () => hideT4HoverTip());
      });
    }

    let t4MermaidRendered = false;

    function ensureT4MermaidSources(panel) {
      panel.querySelectorAll('pre.mermaid').forEach((pre) => {
        if (pre.dataset.mermaidSrc) return;
        const raw = (pre.textContent || '').trim();
        if (raw && !raw.startsWith('#mermaid')) pre.dataset.mermaidSrc = raw;
      });
    }

    function t4ChartsNeedRerender(panel) {
      const wraps = panel.querySelectorAll('.mermaid-wrap');
      if (!wraps.length) return true;
      for (let i = 0; i < wraps.length; i++) {
        const svg = wraps[i].querySelector('svg');
        if (!svg) return true;
        const r = svg.getBoundingClientRect();
        if (r.width < 48 || r.height < 48) return true;
      }
      return false;
    }

    function resetT4MermaidBlocks(panel) {
      panel.querySelectorAll('pre.mermaid').forEach((pre) => {
        const src = pre.dataset.mermaidSrc;
        if (!src) return;
        pre.removeAttribute('data-processed');
        pre.innerHTML = '';
        pre.textContent = src;
      });
      panel.querySelectorAll('.mermaid-wrap').forEach((w) => w.classList.remove('mermaid-failed'));
    }

    let t4MermaidRendering = false;

    function renderT4Mermaid() {
      const panel = semGet('sem-panel-t4');
      if (!panel || !panel.classList.contains('active')) return;
      initT4QuickPicks();
      bindT4ArchLayers();
      bindT4MermaidClicks();
      ensureT4MermaidSources(panel);
      const blocks = panel.querySelectorAll('pre.mermaid');
      if (!blocks.length) return;
      if (typeof mermaid === 'undefined') {
        panel.querySelectorAll('.mermaid-wrap').forEach((w) => w.classList.add('mermaid-failed'));
        return;
      }
      const needsRerender = t4ChartsNeedRerender(panel);
      if (t4MermaidRendered && !needsRerender) return;
      if (t4MermaidRendering) return;
      if (needsRerender) resetT4MermaidBlocks(panel);
      t4MermaidRendering = true;
      try {
        mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
        mermaid.run({ nodes: blocks }).then(() => {
          t4MermaidRendered = !t4ChartsNeedRerender(panel);
          bindT4MermaidClicks();
          if (t4ChartsNeedRerender(panel)) {
            t4MermaidRendered = false;
            setTimeout(() => renderT4Mermaid(), 120);
          }
        }).catch((err) => {
          console.warn('[semantic-guide] mermaid.run failed', err);
          t4MermaidRendered = false;
          panel.querySelectorAll('.mermaid-wrap').forEach((w) => w.classList.add('mermaid-failed'));
        }).finally(() => {
          t4MermaidRendering = false;
        });
      } catch (err) {
        t4MermaidRendering = false;
        console.warn('[semantic-guide] mermaid init failed', err);
      }
    }

    
  function __semGuideActivateTab(tab) {
    root.querySelectorAll('.sem-tab-link').forEach(b => {
      b.classList.toggle('sem-tab-active', b.getAttribute('data-sem-tab') === tab);
    });
    root.querySelectorAll('.sem-panel').forEach(p => p.classList.remove('sem-panel-active'));
    const panel = semGet('sem-panel-' + tab);
    if (panel) panel.classList.add('sem-panel-active');
    const body = root.querySelector('.sem-guide-body');
    if (body) body.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (tab === 't4') requestAnimationFrame(() => { try { renderT4Mermaid(); } catch (e) {} });
  }
  root.querySelectorAll('.sem-tab-link').forEach(btn => {
    btn.addEventListener('click', () => __semGuideActivateTab(btn.getAttribute('data-sem-tab')));
  });
  __semGuideActivateTab('playbook');
}
