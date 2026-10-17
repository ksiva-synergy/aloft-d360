/**
 * Inlines rich HTML guides into architecture-guide.source.html, then builds
 * single-file architecture-guide.html (local CSS/JS inlined). Also runs embed-semantic-guide.mjs.
 *   node scripts/embed-architecture-guides.mjs
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  scopeCss,
  extractStyleBlock,
  extractMainSections,
  extractLayoutGuide,
  sanitizeEmbeddedNav,
  insertPageBefore,
  buildTabPanels,
  buildTabNav,
  replacePageBlock,
  appendScopedCss,
  escapeTemplateLiteral,
} from './lib/guide-embed.mjs';

const IN_APP_GUIDE_BTN = (pageKey, label = 'Open in this guide') =>
  `<button type="button" onclick="showDedicatedPage('${pageKey}')" class="px-3 py-1.5 rounded-xl border">${label}</button>`;

const root = path.join(import.meta.dirname, '..');
const archPath = path.join(root, 'architecture-guide.source.html');
const cssRichPath = path.join(root, 'docs', 'architecture-module-rich.css');

spawnSync(process.execPath, [path.join(root, 'scripts', 'embed-semantic-guide.mjs')], {
  stdio: 'inherit',
  cwd: root,
});

let arch = fs.readFileSync(archPath, 'utf8');

function extractPanelHtml(html, panelName) {
  const marker = `id="panel-${panelName}"`;
  const start = html.indexOf(marker);
  if (start < 0) return '';
  const divStart = html.lastIndexOf('<div', start);
  const nextPanel = html.indexOf('<div class="panel"', start + 10);
  const footer = html.indexOf('<footer>', start);
  const end = nextPanel > 0 ? nextPanel : footer;
  let chunk = html.slice(divStart, end);
  chunk = chunk.replace(/^<div class="panel[^"]*"[^>]*>/, '').replace(/<\/div>\s*$/, '');
  return chunk.trim();
}

function ensureHeadAssets() {
  if (!arch.includes('architecture-catalog-ui.css')) {
    arch = arch.replace(
      '<link rel="stylesheet" href="docs/architecture-module-rich.css">',
      '<link rel="stylesheet" href="docs/architecture-module-rich.css">\n  <link rel="stylesheet" href="docs/architecture-catalog-ui.css">'
    );
  }
  if (!arch.includes('architecture-module-rich.css')) {
    arch = arch.replace(
      '<link rel="stylesheet" href="docs/semantic-layer-guide-arch.css">',
      '<link rel="stylesheet" href="docs/semantic-layer-guide-arch.css">\n  <link rel="stylesheet" href="docs/architecture-module-rich.css">'
    );
  }
  if (!arch.includes('architecture-module-guide-init.js')) {
    arch = arch.replace(
      '<script src="docs/semantic-layer-guide-init.js"></script>',
      '<script src="docs/semantic-layer-guide-init.js"></script>\n  <script src="docs/architecture-module-guide-init.js"></script>'
    );
  }
  const initBlock = `
      if (pageKey === 'harvester') {
        initHarvestGuidePage(body.querySelector('#harvest-guide-root'));
      }
      if (pageKey === 'memory-foer') {
        initAgentMemoryGuidePage(body.querySelector('#agentmem-guide-root'));
      }
      if (pageKey === 'self-improving-memory') {
        initSelfImprovingGuidePage(body.querySelector('#sim-guide-root'));
        if (typeof initSimGuideInteractive === 'function') {
          initSimGuideInteractive(body.querySelector('#sim-guide-root'));
        }
      }
      if (pageKey === 'database-tables') {
        initDatabaseTablesGuide(body.querySelector('#dbguide-root'));
      }
      if (pageKey === 'memory-database-tables') {
        initMemoryDbTablesGuide(body.querySelector('#memorydb-guide-root'));
      }
      enrichArchModulePage(pageKey, body);`;
  if (!arch.includes('initHarvestGuidePage')) {
    arch = arch.replace(
      `      if (pageKey === 'semantic') {
        initSemanticGuidePage(body.querySelector('#semantic-guide-root'));
      }`,
      `      if (pageKey === 'semantic') {
        initSemanticGuidePage(body.querySelector('#semantic-guide-root'));
      }
${initBlock}`
    );
  }
  const dbInit = `
      if (pageKey === 'database-tables') {
        initDatabaseTablesGuide(body.querySelector('#dbguide-root'));
      }
      if (pageKey === 'memory-database-tables') {
        initMemoryDbTablesGuide(body.querySelector('#memorydb-guide-root'));
      }`;
  if (!arch.includes('initDatabaseTablesGuide')) {
    arch = arch.replace(
      `      enrichArchModulePage(pageKey, body);`,
      `${dbInit}
      enrichArchModulePage(pageKey, body);`
    );
  }
}

// ——— Context harvesting → harvester ———
const harvestPath = path.join(root, 'docs', 'context-harvesting-guide.html');
const harvestHtml = fs.readFileSync(harvestPath, 'utf8');
const harvestSections = extractMainSections(harvestHtml);
const harvestMap = new Map(harvestSections.map((s) => [s.id, s.html]));
const harvestGroups = [
  {
    tab: 'overview',
    label: 'Purpose & architecture',
    group: 'Start here',
    ids: ['purpose', 'schedule', 'architecture', 'workflow', 'prerequisites', 'source-scope'],
  },
  {
    tab: 'pipeline',
    label: 'Triggers & T0–embed',
    group: 'Pipeline',
    ids: [
      'triggers',
      'step-change-detect',
      'step-t0',
      'step-t0-deep',
      'step-t1',
      'step-t2',
      'step-embed',
    ],
  },
  {
    tab: 'advanced',
    label: 'T3 · Mapper · Silo',
    group: 'Pipeline',
    ids: ['step-t3', 'step-mapper', 'step-silo', 'step-other'],
  },
  {
    tab: 'operations',
    label: 'Inspector & ops',
    group: 'Use in prod',
    ids: ['inspector-example', 'timeline', 'splitting', 'mental-model', 'references'],
  },
];
const harvestPanels = buildTabPanels({
  scopeClass: 'harvest-dedicated',
  panelPrefix: 'harvest',
  groups: harvestGroups,
  sectionsById: harvestMap,
});
const harvestNav = buildTabNav(harvestGroups, 'harvest');
const harvestStyle = extractStyleBlock(harvestHtml);
appendScopedCss(cssRichPath, '.harvest-dedicated', harvestStyle);

const harvestBlock = `
        <div class="dedicated-page harvest-dedicated" id="harvest-guide-root">
          <div class="mb-4 flex gap-2 flex-wrap">
            <span class="px-3 py-1 text-xs bg-[#FDB515] text-[#003262] rounded-full font-semibold">DATA ESTATE</span>
            <span class="px-3 py-1 text-xs bg-[#fef3c7] text-[#92400e] rounded-full font-semibold">T0–T3 + Mapper + Silo</span>
          </div>
          <h1 class="text-3xl font-bold mb-2">Context Harvesting — Architecture &amp; Step-by-Step</h1>
          <p class="text-lg text-[#5a6578] max-w-3xl">How the harvester discovers Databricks objects, profiles and enriches them, embeds for search, and powers Inspector <strong>harvested</strong> mode. Same depth as the Semantic Layer guide — inlined here.</p>
          <div class="mod-intro">
            <strong>New here?</strong> Read <em>Purpose &amp; architecture</em>, then <em>Triggers &amp; T0–embed</em> for the factory line.
            <div class="mod-path">
              <button type="button" class="mod-path-step" onclick="window.__harvestActivateTab&&__harvestActivateTab('overview')"><span>1</span> Why we harvest</button>
              <button type="button" class="mod-path-step" onclick="window.__harvestActivateTab&&__harvestActivateTab('pipeline')"><span>2</span> Pipeline steps</button>
              <button type="button" class="mod-path-step" onclick="window.__harvestActivateTab&&__harvestActivateTab('operations')"><span>3</span> Inspector example</button>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-2 text-sm">
            <button type="button" onclick="showDedicatedPage('semantic'); setTimeout(()=>window.__semActivateTab&&__semActivateTab('estate'),80)" class="px-3 py-1.5 rounded-xl border">Semantic estate jobs T0–T4</button>
            <button type="button" onclick="showDedicatedPage('database-tables')" class="px-3 py-1.5 rounded-xl border">All database tables</button>
          </div>
${harvestNav}
          <div class="mod-guide-body">
${harvestPanels}
          </div>
        </div>`;

arch = replacePageBlock(arch, 'harvester', 'estate-jobs', harvestBlock);

// ——— AI / Agent / Memory guide → memory-foer ———
const agentPath = path.join(root, 'docs', 'ai-agent-memory-guide.html');
const agentHtml = fs.readFileSync(agentPath, 'utf8');
const agentPanels = new Map(
  ['ai', 'agent', 'memory'].map((name) => [name, extractPanelHtml(agentHtml, name)])
);
const agentGroups = [
  { tab: 'ai', label: 'AI layer', group: 'Read in order', panelIds: ['ai'] },
  { tab: 'agent', label: 'Agent runtime', group: 'Read in order', panelIds: ['agent'] },
  { tab: 'memory', label: 'Memory system', group: 'Read in order', panelIds: ['memory'] },
  {
    tab: 'foer-app',
    label: 'FOER in the app',
    group: 'Related',
    panelIds: ['foer-app'],
  },
];
agentPanels.set(
  'foer-app',
  `<section class="block"><h2>FOER routes &amp; ops surfaces</h2>
  <p class="text-sm">Full closed-loop synthesis is in <button type="button" class="underline text-[#003262]" onclick="showDedicatedPage('self-improving-memory')">Self-Improving Memory</button>. These are the primary UI entry points:</p>
  <table><thead><tr><th>Route</th><th>Purpose</th></tr></thead><tbody>
  <tr><td><code>/agent-lab/memory</code></td><td>Browse bullets, reputation, injection history</td></tr>
  <tr><td><code>/agent-lab/memory/ops</code></td><td>Job health, manual synthesis triggers</td></tr>
  <tr><td><code>/agent-lab/memory/contributions</code></td><td>Attribution — who taught what</td></tr>
  <tr><td><code>/teach</code></td><td>Deliberate high-signal rules (parallel to synthesis)</td></tr>
  </tbody></table>
  <p class="text-sm mt-3">Key code: <span class="file-ref">lib/memory/retrieve.ts</span>, <span class="file-ref">lib/memory/orchestrate.ts</span>, <span class="file-ref">lib/memory/synthesis/*</span>.</p></section>`
);
const agentTabPanels = buildTabPanels({
  scopeClass: 'agentmem-dedicated',
  panelPrefix: 'agentmem',
  groups: agentGroups,
  panelsById: agentPanels,
});
const agentNav = buildTabNav(agentGroups, 'agentmem');
const agentStyle = extractStyleBlock(agentHtml);
appendScopedCss(cssRichPath, '.agentmem-dedicated', agentStyle);

const agentBlock = `
        <div class="dedicated-page agentmem-dedicated" id="agentmem-guide-root">
          <div class="mb-4 flex gap-2 flex-wrap">
            <span class="px-3 py-1 text-xs bg-[#d1fae5] text-[#065f46] rounded-full font-semibold">AI · AGENT · MEMORY</span>
          </div>
          <h1 class="text-3xl font-bold mb-2">FOER Memory — AI, Agent &amp; Memory Stack</h1>
          <p class="text-lg text-[#5a6578] max-w-3xl">How Bedrock, the Inspector agent loop, and FOER memory fit together — then how rules are injected, attributed, and synthesized overnight.</p>
          <div class="mod-intro">
            <strong>Reading path:</strong> AI layer → Agent runtime → Memory system → Self-improving loop (separate guide).
            <div class="mod-path">
              <button type="button" class="mod-path-step" onclick="window.__agentMemActivateTab&&__agentMemActivateTab('ai')"><span>1</span> AI layer</button>
              <button type="button" class="mod-path-step" onclick="window.__agentMemActivateTab&&__agentMemActivateTab('agent')"><span>2</span> Agent runtime</button>
              <button type="button" class="mod-path-step" onclick="window.__agentMemActivateTab&&__agentMemActivateTab('memory')"><span>3</span> Memory system</button>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-2 text-sm">
            <button type="button" onclick="showDedicatedPage('self-improving-memory')" class="px-3 py-1.5 rounded-xl bg-[#6d28d9] text-white font-semibold">Self-improving memory loop</button>
            <button type="button" onclick="showDedicatedPage('memory-database-tables')" class="px-3 py-1.5 rounded-xl border">Memory DB tables</button>
          </div>
${agentNav}
          <div class="mod-guide-body">
${agentTabPanels}
          </div>
        </div>`;

arch = replacePageBlock(arch, 'memory-foer', 'memory-ops', agentBlock);

// ——— Self-improving memory guide ———
const simPath = path.join(root, 'docs', 'self-improving-memory-guide.html');
const simHtml = fs.readFileSync(simPath, 'utf8');
const simSections = extractMainSections(simHtml);
const simMap = new Map(simSections.map((s) => [s.id, s.html]));
const simGroups = [
  { tab: 'overview', label: 'What it means', group: 'Start here', ids: ['purpose', 'interactive-flow'] },
  {
    tab: 'architecture',
    label: 'Architecture & layers',
    group: 'Build',
    ids: ['architecture', 'layers', 'bullets'],
  },
  {
    tab: 'daytime',
    label: 'Daytime loop',
    group: 'Build',
    ids: ['chat-entry', 'trace', 'injection', 'attribution', 'marcus'],
  },
  {
    tab: 'overnight',
    label: 'Overnight jobs',
    group: 'Build',
    ids: ['dag', 'sweep', 'reflect', 'curate', 'refine', 'foer'],
  },
  {
    tab: 'reference',
    label: 'Teach · tables · config',
    group: 'Reference',
    ids: ['teach', 'reputation', 'tables-db', 'config', 'timeline-example', 'files'],
  },
];
const simPanels = buildTabPanels({
  scopeClass: 'sim-dedicated',
  panelPrefix: 'sim',
  groups: simGroups,
  sectionsById: simMap,
});
const simNav = buildTabNav(simGroups, 'sim');
const simStyle = extractStyleBlock(simHtml);
appendScopedCss(cssRichPath, '.sim-dedicated', simStyle);

const simScriptMatch = simHtml.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
let simInit = '';
if (simScriptMatch) {
  simInit = simScriptMatch[1]
    .replace(/document\.getElementById\(/g, 'simGet(')
    .replace(/document\.querySelector\(/g, 'root.querySelector(')
    .replace(/document\.querySelectorAll\(/g, 'root.querySelectorAll(')
    .replace(/getElementById\('flow-detail'\)/g, "simGet('sim-flow-detail')")
    .replace(/simGet\('flow-detail'\)/g, "simGet('sim-flow-detail')")
    .replace(/id="flow-detail"/g, 'id="sim-flow-detail"')
    .replace(/function initPage\(\)/g, 'function initSimGuideInteractive(root)')
    .replace(/if \(document\.readyState[\s\S]*?initPage\(\);\s*\}/, '');
  simInit = `function simGet(id) {
  return root.querySelector('#' + id);
}
function initSimGuideInteractive(root) {
  if (!root || root.dataset.simInteractive === '1') return;
  root.dataset.simInteractive = '1';
  ${simInit}
}
`;
  fs.writeFileSync(path.join(root, 'docs', 'self-improving-guide-arch-init.js'), simInit);
}

const simBlock = `
        <div class="dedicated-page sim-dedicated" id="sim-guide-root">
          <div class="mb-4 flex gap-2 flex-wrap">
            <span class="px-3 py-1 text-xs bg-[#f3e8ff] text-[#6d28d9] rounded-full font-semibold">CLOSED LOOP</span>
          </div>
          <h1 class="text-3xl font-bold mb-2">Self-Improving Memory</h1>
          <p class="text-lg text-[#5a6578] max-w-3xl">Daytime injection + overnight synthesis — no model fine-tuning. Traces, attribution, Marcus, DAG jobs, and FOER storage — full guide inlined.</p>
          <div class="mod-intro">
            <strong>Interactive flow:</strong> open <em>What it means</em> → click steps in the diagram (or flow blocks) for detail panels.
            <div class="mod-path">
              <button type="button" class="mod-path-step" onclick="window.__simActivateTab&&__simActivateTab('overview')"><span>1</span> Overview + diagram</button>
              <button type="button" class="mod-path-step" onclick="window.__simActivateTab&&__simActivateTab('daytime')"><span>2</span> Daytime loop</button>
              <button type="button" class="mod-path-step" onclick="window.__simActivateTab&&__simActivateTab('overnight')"><span>3</span> Overnight jobs</button>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-2 text-sm">
            <button type="button" onclick="showDedicatedPage('memory-foer')" class="px-3 py-1.5 rounded-xl border">AI / Agent / Memory stack</button>
            <button type="button" onclick="showDedicatedPage('memory-database-tables')" class="px-3 py-1.5 rounded-xl border">Memory database tables</button>
            <button type="button" onclick="showDedicatedPage('database-tables')" class="px-3 py-1.5 rounded-xl border">Full Prisma catalog (142 tables)</button>
          </div>
${simNav}
          <div class="mod-guide-body">
${simPanels.replace(/id="flow-detail"/g, 'id="sim-flow-detail"')}
          </div>
        </div>`;

arch = replacePageBlock(arch, 'self-improving-memory', 'estate-overview', simBlock);

// Estate jobs: pointer to full harvest guide (avoid duplicate pipeline prose)
const estateJobsIntro = `
          <div class="mod-intro mb-6">
            <strong>Full pipeline guide:</strong> Step-by-step T0–T3, Mapper, Silo, triggers, and Inspector examples live in
            <button type="button" class="underline font-semibold text-[#003262]" onclick="showDedicatedPage('harvester')">Context Harvesting</button>
            (tab <em>Triggers &amp; T0–embed</em>). This page focuses on <strong>job operations</strong> and stage tabs below.
          </div>`;
if (arch.includes("'estate-jobs': `") && !arch.includes('Full pipeline guide:')) {
  arch = arch.replace(
    /('estate-jobs': `\s*<div class="dedicated-page">[\s\S]*?<h1 class="text-3xl font-bold mb-1">Jobs)/,
    `'estate-jobs': \`
        <div class="dedicated-page arch-module-rich">
          <div class="mb-4">
            <span class="px-3 py-1 text-xs bg-[#FDB515] text-[#003262] rounded-full font-semibold">HARVESTER PIPELINE</span>
          </div>
${estateJobsIntro}
          <h1 class="text-3xl font-bold mb-1">Jobs`
  );
}

// ——— Database table catalogs (full HTML inlined) ———
const dbLayoutExtra = `
.dbguide-dedicated .dbguide-layout,
.memorydb-dedicated .memorydb-layout {
  display: flex;
  gap: 0;
  align-items: flex-start;
}
.dbguide-dedicated nav.dbguide-nav,
.memorydb-dedicated nav.memorydb-nav {
  position: sticky;
  top: 0;
  align-self: flex-start;
  max-height: min(75vh, 900px);
  overflow-y: auto;
}
.dbguide-dedicated main.dbguide-main,
.memorydb-dedicated main.memorydb-main {
  flex: 1;
  min-width: 0;
}
`;

const allDbPath = path.join(root, 'docs', 'all-database-tables-guide.html');
const allDbHtml = fs.readFileSync(allDbPath, 'utf8');
const allDbParts = extractLayoutGuide(allDbHtml);
const allDbNav = sanitizeEmbeddedNav(allDbParts.navHtml, 'self-improving-memory');
const allDbStyle = extractStyleBlock(allDbHtml);
appendScopedCss(cssRichPath, '.dbguide-dedicated', allDbStyle, dbLayoutExtra);

const allDbBlock = `
        <div class="dedicated-page dbguide-dedicated" id="dbguide-root">
          <div class="mb-3 flex flex-wrap gap-2 text-sm">
            ${IN_APP_GUIDE_BTN('repo-documentation', '← Repo docs hub')}
            ${IN_APP_GUIDE_BTN('memory-database-tables', 'Memory tables (12)')}
            ${IN_APP_GUIDE_BTN('platform-architecture', 'Interactive architecture')}
          </div>
          <div class="dbguide-explainer mod-intro">
            <strong>Prisma catalog (142 tables):</strong> Three steps — <em>1) pick a group</em> → <em>2) pick a table</em> → <em>3) read columns</em>. Left tree jumps straight to a table. Search opens a short result list, not one giant scroll.
          </div>
          <div class="dbguide-layout">
            <nav class="dbguide-nav" aria-label="Database tables">${allDbNav}</nav>
            <main class="dbguide-main">${allDbParts.mainHtml}</main>
          </div>
        </div>`;

const memDbPath = path.join(root, 'docs', 'memory-database-tables-guide.html');
const memDbHtml = fs.readFileSync(memDbPath, 'utf8');
const memDbParts = extractLayoutGuide(memDbHtml);
const memDbNav = sanitizeEmbeddedNav(memDbParts.navHtml, 'self-improving-memory');
const memDbStyle = extractStyleBlock(memDbHtml);
appendScopedCss(cssRichPath, '.memorydb-dedicated', memDbStyle, dbLayoutExtra);

const memDbBlock = `
        <div class="dedicated-page memorydb-dedicated" id="memorydb-guide-root">
          <div class="mb-3 flex flex-wrap gap-2 text-sm">
            ${IN_APP_GUIDE_BTN('self-improving-memory', '← Self-improving memory')}
            ${IN_APP_GUIDE_BTN('memory-foer', 'AI / Agent / Memory')}
            ${IN_APP_GUIDE_BTN('database-tables', 'Full Prisma catalog')}
          </div>
          <div class="memorydb-layout">
            <nav class="memorydb-nav" aria-label="Memory tables">${memDbNav}</nav>
            <main class="memorydb-main">${memDbParts.mainHtml}</main>
          </div>
        </div>`;

if (!arch.includes("'database-tables': `")) {
  arch = insertPageBefore(arch, 'memory-database-tables', memDbBlock, 'default');
  arch = insertPageBefore(arch, 'database-tables', allDbBlock, 'default');
}

ensureHeadAssets();
if (simInit && !arch.includes('self-improving-guide-arch-init.js')) {
  arch = arch.replace(
    '<script src="docs/architecture-module-guide-init.js"></script>',
    '<script src="docs/architecture-module-guide-init.js"></script>\n  <script src="docs/self-improving-guide-arch-init.js"></script>'
  );
}

fs.writeFileSync(archPath, arch);

const build = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-architecture-guide-standalone.mjs')], {
  stdio: 'inherit',
  cwd: root,
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

console.log(
  'OK: source updated; architecture-guide.html rebuilt (single file — open this in the browser).'
);
