function simGet(id) {
  return root.querySelector('#' + id);
}
function initSimGuideInteractive(root) {
  if (!root || root.dataset.simInteractive === '1') return;
  root.dataset.simInteractive = '1';
  
    const FLOW = {
      'user-question': {
        lane: 'day', laneLabel: 'Daytime',
        title: 'User question',
        what: 'The analyst’s natural-language request that starts one Inspector turn (e.g. crew counts, certificate expiry, vessel voyages).',
        how: [
          'Request hits POST /api/inspector/chat with sessionId, messages, and model choice.',
          'The first user message text is sliced (~500 chars) as task context for memory retrieval and FOER topic matching.',
          'The same text is what Phase 1b embeds for semantic bullet search.'
        ],
        ex1: 'User asks: “How many active crew certificates expire this month?”',
        ex2: 'Next turn: “Break that down by vessel” — new retrieval runs; trace links corrections if the prior SQL failed.'
      },
      'select-memory': {
        lane: 'day', laneLabel: 'Daytime',
        title: 'selectMemoryAll — retrieve bullets',
        what: 'Before the model thinks, the platform loads the best-fitting memory rules from Postgres (three phases).',
        how: [
          'Checks MEMORY_INJECT_ENABLED and MEMORY_INJECT_CLASSES includes inspector.',
          'Runs Phase 0, 1a, 1b in retrieve.ts with token budgets from phases.ts.',
          'Optional MMR diversifies Phase 1b; personal taught lane adds the caller’s own rules.',
          'Returns bullet objects formatted into OPERATING MEMORY blocks.'
        ],
        ex1: 'Question mentions “crew certificates” → Phase 1b cosine search returns HEURISTIC: filter status=ACTIVE first.',
        ex2: 'If injection is off, this step is skipped — traces still record for overnight synthesis.'
      },
      'prompt-inject': {
        lane: 'day', laneLabel: 'Daytime',
        title: 'Prompt + memory injection',
        what: 'Stacked instructions the model sees: base Inspector prompt, semantic context, then memory blocks.',
        how: [
          'Phase 0 and 1a append to finalSystemPrompt.',
          'Phase 1b is injected as a synthetic assistant message before the first user turn (recall pattern).',
          'Model reads memory as operational rules, not as user chat.'
        ],
        ex1: 'System prompt ends with: === OPERATING MEMORY | phase:schema_global === … SCHEMA_MAP bullets …',
        ex2: 'Assistant recall turn: === OPERATING MEMORY | phase:task_scoped === … FAILURE_MODE about unqualified table names …'
      },
      'agent-loop': {
        lane: 'day', laneLabel: 'Daytime',
        title: 'Agent loop (Bedrock + tools)',
        what: 'The execution engine: Claude plans tool calls, runs SQL on Databricks, emits charts, streams SSE to the UI.',
        how: [
          'agent-loop.ts calls Bedrock ConverseStream up to 8 rounds per message.',
          'Each tool_use → executeInspectorTool (read-only SQL gate, catalog search, charts).',
          'Trajectory + trace nodes recorded per tool; user sees SQL and results live.'
        ],
        ex1: 'Loop 1: describe_schema search “crew certificates”. Loop 2: execute_tool SELECT … WHERE status=\'ACTIVE\' …',
        ex2: 'Failed TABLE_NOT_FOUND → DEAD_END trace node → tomorrow’s synthesis may emit FAILURE_MODE rule.'
      },
      'trace': {
        lane: 'day', laneLabel: 'Daytime',
        title: 'Trace graph',
        what: 'A durable graph of what happened in the session — the primary input for overnight learning.',
        how: [
          'openSession() in trace/capture.ts writes ACTION, OUTCOME, CORRECTION, DEAD_END, SOURCE nodes.',
          'Edges LED_TO and CORRECTED_BY link the story.',
          'reconstructSession() rebuilds an ordered walk (CTE, depth ≤ 3) for reflect and Rama validation.'
        ],
        ex1: 'ACTION execute_tool → OUTCOME 47 rows → user CORRECTION “expiry_date is DATE not timestamp”.',
        ex2: 'Synthesis will treat user CORRECTION as ground truth; reflect must not contradict it.'
      },
      'record-injection': {
        lane: 'day', laneLabel: 'Daytime',
        title: 'recordInjection',
        what: 'Persists exactly which memory bullets were injected into this run — needed for attribution.',
        how: [
          'Called from chat/route.ts after selectMemoryAll, with sessionId as runId.',
          'Inserts into platform_memory_injections (run_id, bullet_id, phase).',
          'ON CONFLICT DO NOTHING — safe if called twice.'
        ],
        ex1: 'Run injects 3 bullets: 1× INIT HARD_RULE, 2× TASK_SCOPED HEURISTIC → 3 injection rows.',
        ex2: 'Synthetic default guardrail IDs starting with __ are filtered out — not attributed.'
      },
      'attribute': {
        lane: 'day', laneLabel: 'Daytime',
        title: 'attributeRunOutcome',
        what: 'Scores whether injected memory helped or hurt this run — closes the quality loop.',
        how: [
          'After stream ends, chat route calls attributeRunOutcome(sessionId, { success }).',
          'Claims unattributed injection rows; updates helpful_count or harmful_count on each bullet.',
          'Success: confidence += 0.02. Repeated harm: bullet may become SUPERSEDED.'
        ],
        ex1: 'Successful certificate query → all injected bullets get helpful_count++.',
        ex2: 'Run fails after bad heuristic → harmful_count++; at 3+ harmful with harmful ≥ helpful → SUPERSEDED.'
      },
      'memory-store': {
        lane: 'store', laneLabel: 'Memory store',
        title: 'platform_agent_memory',
        what: 'The org’s operating memory: short rules with embeddings, scores, and lifecycle status.',
        how: [
          'Bullets created by curate (synthesis) or teachRule (user).',
          'Retrieved by selectMemoryAll; updated by attribution and weekly refine.',
          'Never deleted — bad rules marked SUPERSEDED with valid_until.'
        ],
        ex1: 'ACTIVE row: rule_type HEURISTIC, task_signature a1b2…, rule_text “Use ops.crew_certificates.expiry_date as DATE …”',
        ex2: 'SUPERSEDED row remains in DB for audit; retrieval queries only status=ACTIVE.'
      },
      'phase-0': {
        lane: 'day', laneLabel: 'Phase 0',
        title: 'Phase 0 — INIT guardrails',
        what: 'Small set of must-follow HARD_RULEs after the org has seen them fail at least once.',
        how: [
          'Only HARD_RULE with confidence ≥ 0.9 and harmful_count ≥ 1.',
          'No embedding search — deterministic query.',
          'Injected into system prompt (~200 tokens, max 3 bullets).'
        ],
        ex1: '“Never use unqualified crew_manifest in maritime_db — causes TABLE_NOT_FOUND.”',
        ex2: 'Brand-new HARD_RULE from synthesis has harmful_count 0 → does not appear in Phase 0 until a failed run attributes harm.'
      },
      'phase-1a': {
        lane: 'day', laneLabel: 'Phase 1a',
        title: 'Phase 1a — SCHEMA_GLOBAL',
        what: 'Domain schema map: which catalogs, tables, and columns matter for this agent class and topic.',
        how: [
          'Loads SCHEMA_MAP bullets for inspector, filtered by FOER topicKey when detected.',
          'Sorted by confidence × net helpful; capped by MEMORY_PHASE1A_BUDGET.',
          'Personal taught SCHEMA_MAPs can appear via personal lane.'
        ],
        ex1: 'Topic crew_personnel → bullets listing ops.crew_certificates columns cert_id, expiry_date, status.',
        ex2: 'User message has no topic keyword → top global SCHEMA_MAPs for inspector still inject (broader shelf).'
      },
      'phase-1b': {
        lane: 'day', laneLabel: 'Phase 1b',
        title: 'Phase 1b — TASK_SCOPED recall',
        what: 'Situation-specific tips: heuristics, source preferences, and failure warnings matched to the question embedding.',
        how: [
          'embedQuery(user question) → pgvector cosine search on HEURISTIC, SOURCE_PREF, FAILURE_MODE.',
          'Optional MMR re-ranks top 40 candidates for diversity.',
          'Packed into token budget; injected as synthetic assistant recall turn.'
        ],
        ex1: 'Embedding similar to “certificate expiry this month” pulls FAILURE_MODE about DATE_TRUNC vs timestamp.',
        ex2: 'Five near-duplicate “use ops.crew_manifest” bullets → MMR keeps one diverse set instead of five repeats.'
      },
      'orchestrate': {
        lane: 'night', laneLabel: 'Overnight',
        title: 'orchestrate.runDag',
        what: 'Job runner for nightly and weekly memory maintenance with mutual exclusion per org.',
        how: [
          'Acquires advisory lock mem-orch:{orgId}:{group} on DIRECT_URL connection.',
          'Runs job sequence: nightly [synthesize, reclassify?]; weekly [grow_refine, reclassify].',
          'Writes platform_job_runs; releases lock in finally block.'
        ],
        ex1: 'Nightly 04:30 UTC: synthesize completes → coverage 82% → reclassify appended same lock.',
        ex2: 'Second scheduler fires while first runs → lock fails → “skipped: locked” (no duplicate sweep).'
      },
      'sweep': {
        lane: 'night', laneLabel: 'Overnight',
        title: 'runSynthesisSweep',
        what: 'Finds unprocessed Inspector sessions and runs reflect + curate on each.',
        how: [
          'Watermark + source_session_ids prevent reprocessing the same session.',
          'Sessions from platform_trace_nodes newer than watermark.',
          'Per session: signature → reconstruct → reflect → curate; logs platform_memory_synthesis_details.'
        ],
        ex1: 'Monday session with 12 trace nodes → 4 candidate bullets → 2 inserted, 2 deduped against existing.',
        ex2: 'MEMORY_SYNTH_EXCLUDE_SESSION_IDS=abc123 skips one session for a targeted rerun.'
      },
      'reflect': {
        lane: 'night', laneLabel: 'Overnight',
        title: 'reflectSession (LLM)',
        what: 'Captain Track Sparrow reads the trace (+ Marcus) and proposes 0–7 new rule JSON objects.',
        how: [
          'Bedrock Sonnet with marcus_reflect_v3 system prompt.',
          'Inputs: TASK_SIGNATURE, ORDERED_TRACE, EXISTING_BULLETS, MARCUS_REFLECTIONS.',
          'Zod validation; no DB writes — candidates only.'
        ],
        ex1: 'Extracts HEURISTIC: “For expiry in ops.crew_certificates use BETWEEN with DATE_TRUNC on expiry_date (DATE).”',
        ex2: 'Discards: “Table has no country column” inferred only from empty describe_schema — phantom risk.'
      },
      'curate': {
        lane: 'night', laneLabel: 'Overnight',
        title: 'curate — merge into store',
        what: 'Deterministic gatekeeper: scrub, validate against trace, embed, dedup or insert bullets.',
        how: [
          'scrub → validateAgainstTrace (Rama) → optional caveat quarantine → embedQuery.',
          'Nearest neighbour: DEDUP (&lt;0.07), SUPERSEDE (&lt;0.20 + type/conf change), or INSERT.',
          'Reputation hooks if MEMORY_REPUTATION_ENABLED.'
        ],
        ex1: 'New rule near-identical to existing → DEDUP: helpfulCount++ on existing id.',
        ex2: 'Rule names table never in trace → phantomsBlocked; nothing written to ACTIVE store.'
      },
      'foer': {
        lane: 'night', laneLabel: 'FOER',
        title: 'FOER topic clustering',
        what: 'Labels each task_signature with a domain topic so Phase 1a schema maps match the user’s question area.',
        how: [
          'runCluster sends signatures + sample rule texts to Bedrock (fixed vocabulary).',
          'Writes platform_memory_topics for current period.',
          'Target 90% coverage; nightly/weekly reclassify keeps labels fresh.'
        ],
        ex1: 'Signature for crew certificate tasks → topic_key crew_personnel → Phase 1a filters SCHEMA_MAPs.',
        ex2: 'User asks about IMO numbers → topic vessel_voyage → different SCHEMA_MAP shelf injects.'
      },
      'refine': {
        lane: 'night', laneLabel: 'Weekly',
        title: 'grow_refine (refineMemoryStore)',
        what: 'Weekly housekeeping so memory stays bounded and stale rules fade.',
        how: [
          'Dedup clusters across concurrent synthesis duplicates.',
          'TTL by rule_type (e.g. FAILURE_MODE 14 days, SCHEMA_MAP 90 days).',
          'Harmful GC supersede; stats logged for Agent Lab health.'
        ],
        ex1: 'Two ACTIVE bullets 0.05 apart after parallel runs → merged, loser SUPERSEDED.',
        ex2: 'Old SOURCE_PREF unused for 30+ days → EXPIRED/SUPERSEDED per TTL — no hard delete.'
      },
      'marcus': {
        lane: 'day', laneLabel: 'Optional',
        title: 'Marcus reflections',
        what: 'Secondary AI review of the tool trajectory after the user’s answer finishes — extra context for synthesis.',
        how: [
          'MARCUS_REFLECT_ENABLED → evaluateTrajectoryReflection after SSE close.',
          'Stored in platform_marcus_reflections (headline, body, severity).',
          'reflectSession includes non-dismissed reflections in MARCUS_REFLECTIONS JSON.'
        ],
        ex1: 'Marcus: “Efficient 2-tool path; catalog search before SQL” → reflect may encode as HEURISTIC.',
        ex2: 'User dismisses reflection in UI → status dismissed → reflect prompt ignores it.'
      },
      'teach': {
        lane: 'day', laneLabel: 'Manual',
        title: 'Teach mode (parallel path)',
        what: 'User writes a standing rule directly — not extracted from trace — still stored in the same table.',
        how: [
          'teach.ts embeds and inserts personal visibility rule (often SCHEMA_MAP).',
          'Does not go through curate/Rama (no trace required).',
          'promoteRuleToOrg for org-wide; personal lane ensures author sees it before helpful_count grows.'
        ],
        ex1: 'User teaches: “When I say active crew, mean status=\'ACTIVE\' in ops.crew_certificates.”',
        ex2: 'Automatic synthesis from Monday’s session still adds org HEURISTIC; Teach adds personal preference for that user.'
      }
    };

    const MERMAID_TO_FLOW = {
      Q: 'user-question',
      R: 'select-memory',
      P: 'prompt-inject',
      L: 'agent-loop',
      T: 'trace',
      I: 'record-injection',
      A: 'attribute',
      O: 'orchestrate',
      S: 'sweep',
      Ref: 'reflect',
      Cur: 'curate',
      FOER: 'foer',
      Refine: 'refine',
      M: 'memory-store'
    };

    function selectFlow(id) {
      if (!FLOW[id]) return;
      root.querySelectorAll('.flow-block').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-flow') === id);
      });
      renderFlow(id);
    }

    window.flowNodeClick = function (nodeId) {
      var id = MERMAID_TO_FLOW[nodeId];
      if (id) selectFlow(id);
    };

    function renderFlow(id) {
      var data = FLOW[id];
      if (!data) return;
      var panel = simGet('sim-flow-detail');
      if (!panel) return;
      var body = panel.querySelector('.flow-detail-body');
      panel.classList.remove('empty');
      body.innerHTML =
        '<span class="flow-detail-lane ' + data.lane + '">' + data.laneLabel + '</span>' +
        '<h3>' + data.title + '</h3>' +
        '<div class="flow-detail-section"><h4>What is it?</h4><p>' + data.what + '</p></div>' +
        '<div class="flow-detail-section"><h4>How it works</h4><ol>' +
        data.how.map(function (s) { return '<li>' + s + '</li>'; }).join('') +
        '</ol></div>' +
        '<div class="flow-detail-section"><h4>Example 1 — scenario</h4><div class="example-box">' + data.ex1 + '</div></div>' +
        '<div class="flow-detail-section"><h4>Example 2 — outcome</h4><div class="example-box secondary">' + data.ex2 + '</div></div>' +
        (data.code ? '<p class="flow-detail-code">' + data.code + '</p>' : '');
      try {
        history.replaceState(null, '', '#flow-detail');
      } catch (e) { /* file:// may block */ }
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function bindMermaidSvgClicks() {
      root.querySelectorAll('.mermaid-wrap').forEach(function (wrap) {
        if (wrap.dataset.delegationBound) return;
        wrap.dataset.delegationBound = '1';

        wrap.addEventListener('click', function (ev) {
          var node = ev.target.closest
            ? ev.target.closest('g.node, g.actor, g.labelGroup, .messageText, .note')
            : null;
          if (!node || !wrap.contains(node)) return;

          var nodeId = node.id || '';
          var fromId = nodeId.match(/flowchart-([^-]+)-/);
          if (fromId && MERMAID_TO_FLOW[fromId[1]]) {
            ev.preventDefault();
            selectFlow(MERMAID_TO_FLOW[fromId[1]]);
            return;
          }

          var text = (node.textContent || '').replace(/\s+/g, ' ').trim();
          var keys = [
            ['platform_agent_memory', 'memory-store'],
            ['attributeRunOutcome', 'attribute'],
            ['recordInjection', 'record-injection'],
            ['selectMemoryAll', 'select-memory'],
            ['runSynthesisSweep', 'sweep'],
            ['reflectSession', 'reflect'],
            ['refineMemoryStore', 'refine'],
            ['runCluster FOER', 'foer'],
            ['orchestrate.runDag', 'orchestrate'],
            ['System prompt', 'prompt-inject'],
            ['Agent loop', 'agent-loop'],
            ['platform_trace', 'trace'],
            ['User question', 'user-question'],
            ['platform_memory_injections', 'record-injection'],
            ['inspector/chat', 'agent-loop'],
            ['helpful++', 'attribute'],
            ['harmful++', 'attribute'],
            ['SUPERSEDED', 'memory-store'],
            ['curate', 'curate']
          ];
          for (var i = 0; i < keys.length; i++) {
            if (text.indexOf(keys[i][0]) !== -1) {
              ev.preventDefault();
              selectFlow(keys[i][1]);
              return;
            }
          }
        });
      });
    }

    function initSimGuideInteractive(root) {
      root.querySelectorAll('.flow-block').forEach(function (btn) {
        btn.addEventListener('click', function () {
          selectFlow(btn.getAttribute('data-flow'));
        });
      });

      root.querySelectorAll('.sidebar a[data-flow]').forEach(function (link) {
        link.addEventListener('click', function () {
          var id = link.getAttribute('data-flow');
          if (!id) return;
          setTimeout(function () { selectFlow(id); }, 80);
        });
      });

      bindMermaidSvgClicks();

      if (typeof mermaid !== 'undefined') {
        mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
        mermaid.run({ querySelector: '.mermaid' }).then(function () {
          bindMermaidSvgClicks();
        }).catch(function (err) {
          console.warn('[guide] mermaid.run failed', err);
          try {
            mermaid.init(undefined, root.querySelectorAll('.mermaid'));
          } catch (e2) { /* ignore */ }
          setTimeout(bindMermaidSvgClicks, 300);
        });
      } else {
        console.warn('[guide] Mermaid not loaded — use flow buttons; check network for CDN.');
      }

      if (location.hash === '#architecture' || location.hash === '#interactive-flow' || location.hash === '#flow-detail') {
        selectFlow('user-question');
      }
    }

    
  
}
