/* Rich module tabs + auto-enrichment for architecture-guide dedicated pages */

function __modActivateTabInRoot(root, tab, panelPrefix) {
  if (!root) return;
  root.querySelectorAll('.mod-tab-link').forEach((b) => {
    b.classList.toggle('mod-tab-active', b.getAttribute('data-mod-tab') === tab);
  });
  root.querySelectorAll('.mod-panel').forEach((p) => p.classList.remove('mod-panel-active'));
  const panel = root.querySelector(`#${panelPrefix}-panel-${tab}`);
  if (panel) panel.classList.add('mod-panel-active');
  const body = root.querySelector('.mod-guide-body');
  if (body) body.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function initModTabGuide(root, panelPrefix, defaultTab, onActivate) {
  if (!root) return () => {};
  const activate = (tab) => {
    __modActivateTabInRoot(root, tab, panelPrefix);
    if (typeof onActivate === 'function') onActivate(tab, root);
  };
  if (root.dataset.modGuideInit === '1') return activate;
  root.dataset.modGuideInit = '1';
  root.querySelectorAll('.mod-tab-link').forEach((btn) => {
    btn.addEventListener('click', () => activate(btn.getAttribute('data-mod-tab')));
  });
  activate(defaultTab || root.querySelector('.mod-tab-link')?.getAttribute('data-mod-tab') || 'overview');
  return activate;
}

function __modSlugTabId(label, index) {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36);
  return s || `tab-${index}`;
}

function __isAutoOverviewChunk(chunk) {
  return chunk.tabId === 'overview' || chunk.label === 'Overview';
}

/** Merge duplicate "Overview" buckets; rename when a fixed overview lead already exists above tabs. */
function __consolidateAutoOverviewChunks(chunks, page) {
  const hasLead = page.querySelector('.inspector-page-lead');
  const overviewNodes = [];
  const rest = [];
  for (const c of chunks) {
    if (__isAutoOverviewChunk(c)) overviewNodes.push(...c.nodes);
    else rest.push(c);
  }
  if (!overviewNodes.length) return chunks;
  const label = hasLead ? 'At a glance' : 'Overview';
  const tabId = hasLead ? 'at-a-glance' : 'overview';
  return [{ label, nodes: overviewNodes, tabId }, ...rest];
}

function autoTabifyModuleSections(page, pageKey) {
  const body = page.querySelector('.mod-guide-body');
  if (!body || body.dataset.autoTabbed === '1') return;

  const isChunkStart = (el) =>
    el?.classList?.contains('dedicated-section') ||
    el?.classList?.contains('inspector-deep') ||
    (el?.tagName === 'H3' &&
      (el.classList.contains('font-semibold') || el.classList.contains('mt-8'))) ||
    (el?.tagName === 'DETAILS' && el.classList.contains('inspector-deep'));

  const chunks = [];
  let misc = [];

  const children = [...body.children].filter(
    (el) =>
      !el.classList?.contains('mod-tab-nav') && !el.classList?.contains('mod-tab-panels')
  );

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (isChunkStart(child)) {
      if (misc.length) {
        chunks.push({ label: 'Overview', nodes: [...misc], tabId: 'overview' });
        misc = [];
      }
      const nodes = [child];
      // Standalone H3 + following grids/paragraphs belong in one tab (not a second "Overview").
      if (child.tagName === 'H3') {
        while (i + 1 < children.length && !isChunkStart(children[i + 1])) {
          i++;
          nodes.push(children[i]);
        }
      }
      const h3 = child.querySelector('h3') || (child.tagName === 'H3' ? child : null);
      let label = (
        h3?.textContent ||
        child.querySelector('summary')?.textContent ||
        'Topic'
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 52);
      if (page.querySelector('.inspector-page-lead') && /^overview\b/i.test(label)) {
        label = label.replace(/^overview\s*[—–-]?\s*/i, '').trim() || 'Details';
      }
      chunks.push({ label, nodes, tabId: null });
    } else {
      misc.push(child);
    }
  }
  if (misc.length) {
    if (chunks.length) chunks.unshift({ label: 'Overview', nodes: misc, tabId: 'overview' });
    else chunks.push({ label: 'Overview', nodes: misc, tabId: 'overview' });
  }

  let finalChunks = __consolidateAutoOverviewChunks(chunks, page);

  if (finalChunks.length < 2) return;

  const MAX = 10;
  if (finalChunks.length > MAX) {
    const trimmed = finalChunks.slice(0, MAX - 1);
    const restNodes = finalChunks.slice(MAX - 1).flatMap((c) => c.nodes);
    trimmed.push({ label: 'More topics', nodes: restNodes, tabId: 'more' });
    finalChunks = trimmed;
  }

  const panelPrefix = `pg-${pageKey.replace(/-/g, '_')}`;
  const usedIds = new Set();
  finalChunks.forEach((chunk, i) => {
    let tabId = chunk.tabId || __modSlugTabId(chunk.label, i);
    let n = 0;
    while (usedIds.has(tabId)) tabId = `${tabId}-${++n}`;
    usedIds.add(tabId);
    chunk.tabId = tabId;
  });

  const nav = document.createElement('nav');
  nav.className = 'mod-tab-nav';
  nav.setAttribute('data-auto-tabs', '1');
  nav.setAttribute('aria-label', 'Module sections');
  const leadNote = page.querySelector('.inspector-page-lead')
    ? 'The overview card above stays visible. '
    : '';
  nav.innerHTML =
    `<p class="mod-tab-nav-title">${leadNote}Pick a topic — deeper sections below; other tabs are hidden.</p>`;
  const btnWrap = document.createElement('div');
  btnWrap.className = 'mod-tab-buttons';
  nav.appendChild(btnWrap);

  const panelWrap = document.createElement('div');
  panelWrap.className = 'mod-tab-panels';

  finalChunks.forEach((chunk, i) => {
    const tabId = chunk.tabId;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mod-tab-link' + (i === 0 ? ' mod-tab-active' : '');
    btn.setAttribute('data-mod-tab', tabId);
    btn.textContent = chunk.label;
    btnWrap.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'mod-panel' + (i === 0 ? ' mod-panel-active' : '');
    panel.id = `${panelPrefix}-panel-${tabId}`;
    panel.setAttribute('data-mod-tab', tabId);
    panel.setAttribute('data-auto-tab', '1');
    chunk.nodes.forEach((node) => panel.appendChild(node));
    panelWrap.appendChild(panel);
  });

  const guideBody = page.querySelector('.mod-guide-body') || body;
  guideBody.appendChild(panelWrap);
  guideBody.parentNode.insertBefore(nav, guideBody);
  (page.querySelector('.mod-guide-body') || body).dataset.autoTabbed = '1';

  page.querySelector('.mod-toc')?.remove();

  const activate = (tab) => __modActivateTabInRoot(page, tab, panelPrefix);
  btnWrap.querySelectorAll('.mod-tab-link').forEach((btn) => {
    btn.addEventListener('click', () => {
      activate(btn.getAttribute('data-mod-tab'));
      btnWrap.querySelectorAll('.mod-tab-link').forEach((b) => {
        b.classList.toggle('mod-tab-active', b === btn);
      });
    });
  });
  window[`__modActivateTab_${pageKey.replace(/-/g, '_')}`] = activate;

  if (!page.querySelector('.mod-intro') && !page.querySelector('.inspector-reading-path')) {
    const intro = document.createElement('div');
    intro.className = 'mod-intro';
    intro.innerHTML = '<strong>How to read:</strong> Choose a tab below — same pattern as the Semantic Layer guide.';
    const path = document.createElement('div');
    path.className = 'mod-path';
    finalChunks.slice(0, 3).forEach((chunk, i) => {
      const step = document.createElement('button');
      step.type = 'button';
      step.className = 'mod-path-step';
      step.innerHTML = `<span>${i + 1}</span> ${chunk.label}`;
      step.addEventListener('click', () => activate(chunk.tabId));
      path.appendChild(step);
    });
    intro.appendChild(path);
    const h1 = page.querySelector('h1');
    const anchor = page.querySelector('.simple-explain') || h1;
    if (anchor) anchor.insertAdjacentElement('afterend', intro);
  }
}

function initHarvestGuidePage(root) {
  if (!root) return;
  const activate = initModTabGuide(root, 'harvest', 'overview');
  window.__harvestActivateTab = (tab) => activate(tab);
}

function initAgentMemoryGuidePage(root) {
  if (!root) return;
  const activate = initModTabGuide(root, 'agentmem', 'ai');
  window.__agentMemActivateTab = (tab) => activate(tab);
}

function __dbTableSlug(name) {
  return (name || 'table').replace(/[^a-zA-Z0-9_]+/g, '-');
}

function returnPrismaTableCardToVault(card, vault) {
  if (!card || !vault) return;
  card.classList.remove('db-table-detail-mode', 'db-table-active', 'db-classic-detail');
  card.open = false;
  if (!vault.contains(card)) vault.appendChild(card);
}

function mountClassicPrismaTableCard(card, mount, vault) {
  if (!card || !mount) return;
  mount.replaceChildren(card);
  card.classList.add('db-classic-detail', 'db-table-detail-mode');
  card.open = true;
  attachPrismaTableCardEnhancements(card);
}

function attachPrismaTableCardEnhancements(card) {
  if (!card || card.dataset.cardEnhanced === '1') return;
  card.dataset.cardEnhanced = '1';

  const body = card.querySelector('.table-body');
  const table = body?.querySelector('table');
  if (table && !table.parentElement?.classList.contains('db-prisma-table-scroll')) {
    const scroll = document.createElement('div');
    scroll.className = 'db-prisma-table-scroll';
    table.parentNode.insertBefore(scroll, table);
    scroll.appendChild(table);
  }

  if (body && !body.querySelector('.db-classic-col-toolbar')) {
    const toolbar = document.createElement('div');
    toolbar.className = 'db-classic-col-toolbar';
    toolbar.innerHTML =
      '<label class="db-classic-col-search">' +
      '<i class="fas fa-search" aria-hidden="true"></i>' +
      '<input type="search" class="db-classic-col-filter" placeholder="Filter columns in this table…" autocomplete="off">' +
      '</label>';
    body.insertBefore(toolbar, body.firstChild);
    toolbar.querySelector('.db-classic-col-filter')?.addEventListener('input', (e) => {
      const q = (e.target.value || '').toLowerCase().trim();
      card.querySelectorAll('.table-body table tbody tr').forEach((tr) => {
        tr.hidden = !!(q && !tr.textContent.toLowerCase().includes(q));
      });
    });
  }
}

function moveAllCardsToVault(cards, vault) {
  cards.forEach((c) => {
    if (c && vault && !vault.contains(c)) vault.appendChild(c);
  });
}

function renderCardsIntoIngested(matched, cards, vault, ingested, emptyMessage) {
  moveAllCardsToVault(cards, vault);
  ingested.replaceChildren();
  if (!matched.length) {
    const empty = document.createElement('p');
    empty.className = 'db-catalog-empty';
    empty.innerHTML = emptyMessage;
    ingested.appendChild(empty);
    return;
  }
  matched.forEach((card) => ingested.appendChild(card));
}

function parsePrismaTableCard(card) {
  const body = card.querySelector('.table-body');
  const ps = body ? [...body.querySelectorAll(':scope > p:not(.note)')] : [];
  let purposeHtml = '';
  let categoryLine = '';
  let usageHtml = '';
  let columnCount = '';

  ps.forEach((p) => {
    const raw = (p.textContent || '').trim();
    if (raw.startsWith('Purpose:')) {
      purposeHtml = p.innerHTML.replace(/<strong>\s*Purpose:\s*<\/strong>/i, '').trim();
    } else if (raw.startsWith('Category:')) {
      categoryLine = raw;
      const m = raw.match(/Columns:\s*(\d+)/i);
      if (m) columnCount = m[1];
    } else if (/usage/i.test(raw)) {
      usageHtml = p.innerHTML.replace(/<strong>[^<]*:<\/strong>\s*/i, '').trim();
    }
  });

  const pills = [...card.querySelectorAll('summary .pill')].map((el) => el.outerHTML).join('');
  const columns = [];
  const tbl = body?.querySelector('table');
  if (tbl) {
    tbl.querySelectorAll('tbody tr').forEach((tr, i) => {
      const tds = [...tr.querySelectorAll('td')];
      if (!tds.length) return;
      const storageEl = tds[3]?.querySelector('[class*="type-"]');
      columns.push({
        index: i + 1,
        columnHtml: tds[0]?.innerHTML || '—',
        columnText: (tds[0]?.textContent || '').trim(),
        prismaTypeHtml: tds[1]?.innerHTML || '—',
        attributesHtml: tds[2]?.innerHTML || '<span class="db-dict-muted">—</span>',
        storageHtml: tds[3]?.innerHTML || '—',
        storageKind: (storageEl?.textContent || tds[3]?.textContent || '').trim().toLowerCase(),
        sampleHtml: tds[4]?.innerHTML || '<span class="db-dict-muted">—</span>',
      });
    });
  }

  if (!columnCount && columns.length) columnCount = String(columns.length);

  return {
    name: card.dataset.tableName || '',
    model: card.dataset.modelName || card.dataset.tableName || '',
    category: card.dataset.category || '',
    usage: card.dataset.usage || '',
    purposeHtml,
    categoryLine,
    usageHtml,
    columnCount,
    pills,
    columns,
  };
}

function buildTableDictionaryView(card) {
  const data = parsePrismaTableCard(card);
  const used = data.usage === 'used';
  const article = document.createElement('article');
  article.className = 'db-table-dict';
  article.dataset.cardId = card.id;

  const columnRows = data.columns
    .map(
      (col) =>
        `<tr class="db-dict-row" data-col-index="${col.index}" tabindex="0" role="button" aria-label="Column ${col.columnText}">` +
        `<td class="db-dict-num">${col.index}</td>` +
        `<td class="db-dict-col-name">${col.columnHtml}</td>` +
        `<td class="db-dict-type">${col.prismaTypeHtml}</td>` +
        `<td class="db-dict-storage db-dict-storage--${col.storageKind || 'relational'}">${col.storageHtml}</td>` +
        `<td class="db-dict-attrs">${col.attributesHtml}</td>` +
        `<td class="db-dict-sample">${col.sampleHtml}</td>` +
        `</tr>`
    )
    .join('');

  article.innerHTML =
    '<header class="db-dict-header">' +
    '<div class="db-dict-header-top">' +
    '<div class="db-dict-titles">' +
    `<p class="db-dict-kicker">${data.category || 'Prisma model'}</p>` +
    `<h2 class="db-dict-name">${data.name}</h2>` +
    `<p class="db-dict-model">Prisma model <code>${data.model}</code></p>` +
    '</div>' +
    `<div class="db-dict-badges">${data.pills}<span class="db-dict-usage-pill ${used ? 'is-used' : 'is-schema'}">${used ? 'Referenced in code' : 'Schema only'}</span></div>` +
    '</div>' +
    '<dl class="db-dict-meta">' +
    `<div><dt>Category</dt><dd>${data.category || '—'}</dd></div>` +
    `<div><dt>Columns</dt><dd>${data.columnCount || data.columns.length}</dd></div>` +
    `<div><dt>Storage profile</dt><dd>${data.pills || '—'}</dd></div>` +
    '</dl>' +
    '</header>' +
    (data.purposeHtml
      ? `<section class="db-dict-section db-dict-purpose"><h3>Purpose</h3><div class="db-dict-prose">${data.purposeHtml}</div></section>`
      : '') +
    (data.usageHtml
      ? `<details class="db-dict-section db-dict-usage-fold"><summary><h3>Code references</h3><span class="db-dict-fold-hint">Expand file list</span></summary><div class="db-dict-prose db-dict-usage-body">${data.usageHtml}</div></details>`
      : '') +
    '<section class="db-dict-section db-dict-columns">' +
    '<div class="db-dict-columns-head">' +
    `<h3>Columns <span class="db-dict-count">${data.columns.length}</span></h3>` +
    '<label class="db-dict-col-search"><i class="fas fa-search" aria-hidden="true"></i>' +
    '<input type="search" class="db-dict-col-filter" placeholder="Filter columns by name or type…" autocomplete="off">' +
    '</label>' +
    '</div>' +
    '<div class="db-dict-table-wrap" tabindex="0" aria-label="Column definitions">' +
    '<table class="db-dict-table">' +
    '<thead><tr>' +
    '<th scope="col">#</th><th scope="col">Column</th><th scope="col">Prisma type</th><th scope="col">Storage</th><th scope="col">Attributes</th><th scope="col">Sample value</th>' +
    '</tr></thead>' +
    `<tbody>${columnRows || '<tr><td colspan="6" class="db-dict-empty-row">No column rows parsed for this table.</td></tr>'}</tbody>` +
    '</table>' +
    '</div>' +
    '<aside class="db-col-inspector" id="db-col-inspector" hidden aria-live="polite">' +
    '<div class="db-col-inspector-head"><span class="db-col-inspector-label">Column detail</span><button type="button" class="db-col-inspector-close" aria-label="Close column detail">×</button></div>' +
    '<div class="db-col-inspector-body"></div>' +
    '</aside>' +
    '</section>' +
    '<p class="db-dict-footnote">Illustrative samples only — not production data.</p>';

  wireTableDictionaryView(article, data.columns);
  return article;
}

function wireTableDictionaryView(article, columns) {
  const filterInput = article.querySelector('.db-dict-col-filter');
  const tbody = article.querySelector('.db-dict-table tbody');
  const inspector = article.querySelector('.db-col-inspector');
  const inspectorBody = article.querySelector('.db-col-inspector-body');
  const closeBtn = article.querySelector('.db-col-inspector-close');

  const showInspector = (col) => {
    if (!inspector || !inspectorBody || !col) return;
    inspectorBody.innerHTML =
      `<h4 class="db-col-inspector-name">${col.columnHtml}</h4>` +
      '<dl class="db-col-inspector-dl">' +
      `<div><dt>Prisma type</dt><dd>${col.prismaTypeHtml}</dd></div>` +
      `<div><dt>Storage kind</dt><dd>${col.storageHtml}</dd></div>` +
      `<div><dt>Attributes</dt><dd class="db-col-inspector-block">${col.attributesHtml}</dd></div>` +
      `<div><dt>Illustrative sample</dt><dd class="db-col-inspector-block">${col.sampleHtml}</dd></div>` +
      '</dl>';
    inspector.hidden = false;
    article.classList.add('db-col-inspector-open');
  };

  const hideInspector = () => {
    inspector?.setAttribute('hidden', '');
    article.classList.remove('db-col-inspector-open');
    article.querySelectorAll('.db-dict-row.is-selected').forEach((r) => r.classList.remove('is-selected'));
  };

  closeBtn?.addEventListener('click', hideInspector);

  article.querySelectorAll('.db-dict-row').forEach((tr) => {
    const idx = Number(tr.getAttribute('data-col-index'));
    const col = columns.find((c) => c.index === idx);
    const activate = () => {
      article.querySelectorAll('.db-dict-row').forEach((r) => r.classList.remove('is-selected'));
      tr.classList.add('is-selected');
      showInspector(col);
    };
    tr.addEventListener('click', activate);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });
  });

  filterInput?.addEventListener('input', () => {
    const q = (filterInput.value || '').toLowerCase().trim();
    let visible = 0;
    tbody?.querySelectorAll('.db-dict-row').forEach((tr) => {
      const col = columns.find((c) => c.index === Number(tr.getAttribute('data-col-index')));
      const hay = `${col?.columnText} ${col?.storageKind} ${tr.textContent}`.toLowerCase();
      const on = !q || hay.includes(q);
      tr.hidden = !on;
      if (on) visible += 1;
    });
    const countEl = article.querySelector('.db-dict-count');
    if (countEl) countEl.textContent = q ? `${visible} / ${columns.length}` : String(columns.length);
    if (q) hideInspector();
  });
}

function initDatabaseTablesGuide(root) {
  if (!root || root.dataset.dbGuideInit === '1') return;

  const cards = [...root.querySelectorAll('.table-card')];
  const search = root.querySelector('#search');
  const category = root.querySelector('#category');
  const usage = root.querySelector('#usage');
  const count = root.querySelector('#result-count');
  const catalog = root.querySelector('#catalog');
  const tablesHost = root.querySelector('#tables');
  if (!search || !category || !usage || !count || !cards.length || !catalog || !tablesHost) return;

  root.dataset.dbGuideInit = '1';

  root.querySelector('.db-catalog-app')?.remove();

  cards.forEach((card, i) => {
    const name = card.querySelector('.table-name')?.textContent?.trim() || `table-${i + 1}`;
    const model = card.querySelector('.model-name')?.textContent?.trim() || name;
    const id = `dbt-${__dbTableSlug(name)}`;
    card.id = id;
    card.dataset.tableName = name;
    card.dataset.modelName = model;
    card.classList.add('db-table-card-source');
    card.classList.remove('db-table-detail-mode', 'db-table-active', 'db-classic-detail');
  });

  const byCat = new Map();
  cards.forEach((card) => {
    const cat = card.dataset.category || 'Other';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(card);
  });

  tablesHost.id = 'db-catalog-ingested';
  tablesHost.className = 'db-catalog-ingested';

  const vault = document.createElement('div');
  vault.className = 'db-table-vault';
  vault.hidden = true;
  moveAllCardsToVault(cards, vault);
  catalog.appendChild(vault);

  tablesHost.addEventListener(
    'toggle',
    (e) => {
      const card = e.target;
      if (card?.matches?.('details.table-card') && card.open) attachPrismaTableCardEnhancements(card);
    },
    true
  );

  let emptyStackMsg = catalog.querySelector('#db-ingested-empty');
  if (!emptyStackMsg) {
    emptyStackMsg = document.createElement('p');
    emptyStackMsg.id = 'db-ingested-empty';
    emptyStackMsg.className = 'db-ingested-empty note';
    emptyStackMsg.hidden = true;
    emptyStackMsg.textContent = 'No tables match. Try clearing search or choosing All categories.';
    tablesHost.insertAdjacentElement('afterend', emptyStackMsg);
  }

  const catalogTitle = catalog.querySelector('h2');
  if (catalogTitle) catalogTitle.textContent = 'Browse & filter tables';

  const filters = catalog.querySelector('.filters');
  if (filters) {
    filters.classList.add('db-catalog-filters', 'dbguide-sticky-filters');
    if (!filters.querySelector('#db-clear-filters')) {
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.id = 'db-clear-filters';
      clearBtn.className = 'dbguide-focus-btn';
      clearBtn.textContent = 'Clear filters';
      filters.appendChild(clearBtn);
    }
    search.placeholder = 'Search table name, model, category, purpose…';
  }

  catalog.querySelector('#db-category-pills')?.remove();
  catalog.querySelector('.db-split')?.remove();

  const split = document.createElement('div');
  split.className = 'db-split';
  split.innerHTML =
    '<aside class="db-side" aria-label="Tables"><div class="db-side-list" id="db-side-list"></div></aside>' +
    '<section class="db-detail" aria-live="polite"><div class="db-detail-mount" id="db-detail-mount"></div></section>';
  tablesHost.insertAdjacentElement('beforebegin', split);
  const sideList = split.querySelector('#db-side-list');
  const detailMount = split.querySelector('#db-detail-mount');
  let activeCard = null;

  function selectCard(card) {
    if (activeCard && activeCard !== card) {
      activeCard.classList.remove('db-table-detail-mode', 'db-table-active');
      vault.appendChild(activeCard);
    }
    activeCard = card;
    if (!card) {
      detailMount.innerHTML = '<p class="db-ingested-empty note">No tables match. Try clearing search or choosing All categories.</p>';
      return;
    }
    card.classList.add('db-table-detail-mode');
    card.classList.remove('hidden');
    card.open = true;
    detailMount.replaceChildren(card);
    detailMount.scrollTop = 0;
    attachPrismaTableCardEnhancements(card);
    sideList.querySelectorAll('.db-side-row').forEach((row) => {
      const on = row.dataset.id === card.id;
      row.classList.toggle('is-active', on);
      if (on) row.scrollIntoView({ block: 'nearest' });
    });
  }

  function renderSideList(matched) {
    sideList.innerHTML = '';
    matched.forEach((card) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'db-side-row';
      row.dataset.id = card.id;
      const used = card.dataset.usage === 'used';
      row.innerHTML =
        '<span class="db-side-name"></span>' +
        '<span class="db-side-dot ' + (used ? 'used' : 'schema') + '" title="' + (used ? 'Referenced in source' : 'No source reference') + '"></span>';
      row.querySelector('.db-side-name').textContent = card.dataset.tableName;
      row.addEventListener('click', () => selectCard(card));
      sideList.appendChild(row);
    });
  }

  function getFilters() {
    return {
      q: search.value.toLowerCase().trim(),
      c: category.value,
      u: usage.value,
    };
  }

  function cardMatches(card, filters) {
    const { q, c, u } = filters;
    const hay = (card.dataset.search || '').toLowerCase();
    return (
      (!q || hay.includes(q)) &&
      (!c || card.dataset.category === c) &&
      (!u || card.dataset.usage === u)
    );
  }

  function matchingCards() {
    const f = getFilters();
    return cards.filter((card) => cardMatches(card, f));
  }

  function syncGroupNavActive() {
    root.querySelectorAll('nav.dbguide-nav .group-filter').forEach((el) => {
      el.classList.toggle('active', el.getAttribute('data-category') === category.value);
    });
  }

  function syncCatalogChrome(matchedCount) {
    const hasVisible = matchedCount > 0;
    root.classList.remove(
      'db-catalog-detail-open',
      'db-subview-open',
      'db-subview-table',
      'db-catalog-master-detail'
    );
    root.dataset.dbSubview = 'browse';
    document.getElementById('dedicated-view')?.classList.remove('db-tables-table-page');
    if (emptyStackMsg) emptyStackMsg.hidden = hasVisible;

    const titleEl = document.getElementById('dedicated-title');
    if (titleEl) {
      titleEl.innerHTML =
        '<i class="fas fa-table mr-2 text-[#FDB515]"></i>All Database Tables';
    }
  }

  function renderTableList() {
    const f = getFilters();
    const matched = matchingCards();
    const shown = matched.length;
    count.textContent = `${shown} of ${cards.length} tables`;
    renderSideList(matched);
    if (!activeCard || !matched.includes(activeCard)) selectCard(matched[0] || null);
    else selectCard(activeCard);
    syncCatalogChrome(shown);
    syncGroupNavActive();
  }

  function onFilterChange() {
    renderTableList();
  }

  function applyCategoryFromNav(cat) {
    category.value = cat || '';
    search.value = '';
    usage.value = '';
    onFilterChange();
    catalog.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetFilters() {
    search.value = '';
    usage.value = '';
    category.value = '';
    onFilterChange();
  }

  if (!root.querySelector('#db-landing-strip')) {
    const strip = document.createElement('div');
    strip.id = 'db-landing-strip';
    strip.className = 'db-landing-strip';
    strip.innerHTML =
      '<div class="db-landing-strip-text">' +
      '<h1 class="db-landing-title">All ALOFT D360 Database Tables</h1>' +
      '<p class="db-landing-sub">142 Prisma models — <strong>search</strong>, filter by <strong>category</strong>, then open any table for full column detail.</p>' +
      '</div>' +
      '<button type="button" class="db-landing-schema-btn" id="db-open-schema">Schema overview</button>';
    const catalogH2 = catalog.querySelector('h2');
    if (catalogH2) catalog.insertBefore(strip, catalogH2);
    else catalog.prepend(strip);
    strip.querySelector('#db-open-schema')?.addEventListener('click', () => {
      const panel = root.querySelector('#dbguide-intro-panel');
      if (panel) {
        panel.open = true;
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  const introIds = ['summary', 'legend', 'relationships'];
  const introSections = introIds.map((id) => root.querySelector(`#${id}`)).filter(Boolean);
  if (introSections.length >= 2 && !root.querySelector('#dbguide-intro-panel')) {
    const wrap = document.createElement('details');
    wrap.id = 'dbguide-intro-panel';
    wrap.className = 'dbguide-intro-panel';
    wrap.innerHTML =
      '<summary><strong>Schema overview</strong> — summary, storage legend, relationships</summary><div class="dbguide-intro-body"></div>';
    const body = wrap.querySelector('.dbguide-intro-body');
    introSections.forEach((sec) => body.appendChild(sec));
    const main = root.querySelector('main.dbguide-main');
    const hero = main?.querySelector('.hero');
    hero?.insertAdjacentElement('afterend', wrap);
    wrap.open = false;
  }

  search.addEventListener('input', onFilterChange);
  category.addEventListener('change', onFilterChange);
  usage.addEventListener('change', onFilterChange);
  catalog.querySelector('#db-clear-filters')?.addEventListener('click', resetFilters);

  const dbNav = root.querySelector('nav.dbguide-nav');
  dbNav?.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href')?.slice(1);
      if (!id) return;
      const el = root.querySelector('#' + CSS.escape(id));
      if (el && !el.classList.contains('db-table-card-source')) {
        e.preventDefault();
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
  dbNav?.addEventListener('click', (e) => {
    const btn = e.target.closest('.group-filter');
    if (!btn) return;
    e.preventDefault();
    applyCategoryFromNav(btn.getAttribute('data-category'));
  });


  root.classList.add('dbguide-ready', 'dbguide-nested', 'db-catalog-ingested-mode');
  renderTableList();

  requestAnimationFrame(() => {
    const dedView = document.getElementById('dedicated-view');
    if (dedView) dedView.scrollTop = 0;
    root.querySelector('main.dbguide-main')?.scrollTo(0, 0);
  });
}

function mountDbCatalogStudio(root, hooks) {
  if (!root || root.dataset.dbStudioMounted === '1') return;
  root.dataset.dbStudioMounted = '1';
  const resetFilters = hooks?.resetFilters;
  const renderTableList = hooks?.renderTableList;

  const layout = root.querySelector('.dbguide-layout');
  if (!layout) return;

  const catalogH2 = root.querySelector('#catalog > h2');
  if (catalogH2) catalogH2.classList.add('db-catalog-step-label');

  let toolbar = root.querySelector('.db-studio-toolbar');
  if (!toolbar) {
    toolbar = document.createElement('header');
    toolbar.className = 'db-studio-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.innerHTML =
      '<div class="db-studio-toolbar-left">' +
      '<button type="button" class="db-studio-btn" id="db-catalog-exit" title="Back to System overview"><i class="fas fa-arrow-left" aria-hidden="true"></i><span>Overview</span></button>' +
      '<button type="button" class="db-studio-btn" id="db-toggle-rail" aria-expanded="false"><i class="fas fa-list" aria-hidden="true"></i><span>Table index</span></button>' +
      '<button type="button" class="db-studio-btn" id="db-studio-home"><i class="fas fa-th-large" aria-hidden="true"></i><span>All groups</span></button>' +
      '</div>' +
      '<div class="db-studio-toolbar-center">' +
      '<span class="db-studio-kicker">Prisma data dictionary</span>' +
      '<strong class="db-studio-title">142 tables · 9 groups</strong>' +
      '</div>' +
      '<div class="db-studio-toolbar-right">' +
      '<button type="button" class="db-studio-btn db-studio-btn-ghost" data-db-jump="memory-database-tables">Memory tables</button>' +
      '<button type="button" class="db-studio-btn db-studio-btn-accent" id="db-open-schema-toolbar">Schema overview</button>' +
      '</div>';
    const anchor = root.querySelector('.dbguide-explainer') || layout;
    root.insertBefore(toolbar, anchor);
  }

  const railBackdrop = document.createElement('div');
  railBackdrop.className = 'db-studio-rail-backdrop';
  railBackdrop.hidden = true;
  if (!root.querySelector('.db-studio-rail-backdrop')) {
    layout.insertBefore(railBackdrop, layout.firstChild);
  }

  toolbar.querySelector('#db-catalog-exit')?.addEventListener('click', () => {
    if (typeof showOverview === 'function') showOverview(true);
  });
  toolbar.querySelector('#db-toggle-rail')?.addEventListener('click', () => {
    const on = root.classList.toggle('db-rail-open');
    const btn = toolbar.querySelector('#db-toggle-rail');
    btn?.setAttribute('aria-expanded', on ? 'true' : 'false');
    const backdrop = root.querySelector('.db-studio-rail-backdrop');
    if (backdrop) backdrop.hidden = !on;
  });
  railBackdrop.addEventListener('click', () => {
    root.classList.remove('db-rail-open');
    toolbar.querySelector('#db-toggle-rail')?.setAttribute('aria-expanded', 'false');
    railBackdrop.hidden = true;
  });
  toolbar.querySelector('#db-studio-home')?.addEventListener('click', () => {
    if (typeof resetFilters === 'function') resetFilters();
    else root.dispatchEvent(new CustomEvent('db-catalog-home', { bubbles: true }));
  });
  toolbar.querySelector('#db-open-schema-toolbar')?.addEventListener('click', () => {
    root.querySelector('#db-open-schema')?.click();
  });
  toolbar.querySelectorAll('[data-db-jump]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-db-jump');
      if (key && typeof showDedicatedPage === 'function') showDedicatedPage(key);
    });
  });

  root.addEventListener('db-catalog-home', () => {
    if (typeof resetFilters === 'function') resetFilters();
    else if (typeof renderTableList === 'function') renderTableList();
  });
}

const MEMORY_TABLE_GROUPS = {
  'trace-tables': 'Trace tables',
  'memory-tables': 'Memory & learning',
  'operations-tables': 'Operations & topics',
};

function initMemoryDbTablesGuide(root) {
  if (!root || root.dataset.memorydbGuideInit === '1') return;

  const main = root.querySelector('main.memorydb-main');
  if (!main) return;

  const cards = [...main.querySelectorAll('section details')].filter((d) => d.querySelector('.table-title'));
  if (!cards.length) return;

  root.dataset.memorydbGuideInit = '1';

  cards.forEach((card, i) => {
    const name = card.querySelector('.table-title')?.textContent?.trim() || `table-${i + 1}`;
    const sectionId = card.closest('section')?.id || '';
    const category = MEMORY_TABLE_GROUPS[sectionId] || 'Memory tables';
    card.classList.add('table-card', 'memory-table-card', 'memory-table-card-source');
    card.id = card.id || `memdb-${__dbTableSlug(name)}`;
    card.dataset.tableName = name;
    card.dataset.modelName = name;
    card.dataset.category = category;
    const purpose = card.querySelector('.table-body p')?.textContent || '';
    const pills = [...card.querySelectorAll('summary .pill')].map((p) => p.textContent).join(' ');
    card.dataset.search = `${name} ${category} ${purpose} ${pills}`.toLowerCase();
  });

  main.querySelector('.hero')?.setAttribute('hidden', '');
  ['scope', 'storage-types', 'relationships'].forEach((id) => {
    main.querySelector(`#${id}`)?.setAttribute('hidden', '');
  });

  root.querySelector('.memory-studio-toolbar')?.remove();
  root.querySelector('.memory-catalog-app')?.remove();
  root.querySelector('.db-catalog-app')?.remove();

  let refWrap = main.querySelector('#memorydb-reference-depth');
  if (!refWrap) {
    refWrap = document.createElement('details');
    refWrap.id = 'memorydb-reference-depth';
    refWrap.className = 'inspector-deep dedicated-section memorydb-reference-depth';
    refWrap.innerHTML =
      '<summary><strong>Reference depth</strong> — scope, storage types, relationships, vector search, samples</summary><div class="memorydb-reference-body"></div>';
    const refBody = refWrap.querySelector('.memorydb-reference-body');
    ['scope', 'storage-types', 'relationships', 'vector-search', 'sample-flow', 'schema-source'].forEach((id) => {
      const sec = main.querySelector(`#${id}`);
      if (sec) {
        sec.removeAttribute('hidden');
        refBody?.appendChild(sec);
      }
    });
    main.appendChild(refWrap);
  }

  const traceSection = main.querySelector('#trace-tables');
  let catalog = main.querySelector('#memory-catalog');
  if (!catalog) {
    catalog = document.createElement('section');
    catalog.id = 'memory-catalog';
    catalog.className = 'dedicated-section memorydb-catalog-section';
    catalog.innerHTML =
      '<h2><i class="fas fa-table"></i> Table catalog</h2>' +
      '<p class="text-sm text-[#5a6578] mb-3">Search or pick a group, then expand any table for column-level detail (Inspector-style dictionary).</p>' +
      '<div class="filters memory-catalog-filters db-catalog-filters dbguide-sticky-filters">' +
      '<input id="memory-search" type="search" placeholder="Search table name, group, or purpose…" autocomplete="off">' +
      '<select id="memory-category"><option value="">All groups</option></select>' +
      '<button type="button" id="memory-clear-filters" class="dbguide-focus-btn">Clear filters</button>' +
      '</div>' +
      '<div id="memory-category-pills" class="db-category-pills memory-category-pills" role="toolbar" aria-label="Filter by group"></div>' +
      '<p id="memory-result-count" class="memory-result-count"></p>' +
      '<div id="memory-catalog-ingested" class="memory-catalog-ingested db-catalog-ingested"></div>' +
      '<p id="memory-ingested-empty" class="db-ingested-empty note" hidden>No tables match. Try clearing search or choosing <strong>All groups</strong>.</p>';
    traceSection?.insertAdjacentElement('beforebegin', catalog);
  }

  const search = catalog.querySelector('#memory-search');
  const category = catalog.querySelector('#memory-category');
  const count = catalog.querySelector('#memory-result-count');
  const ingested = catalog.querySelector('#memory-catalog-ingested');
  const emptyStackMsg = catalog.querySelector('#memory-ingested-empty');
  const categoryPills = catalog.querySelector('#memory-category-pills');
  if (!search || !category || !count || !ingested) return;

  const groupNames = [...new Set(cards.map((c) => c.dataset.category))].sort();
  groupNames.forEach((g) => {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = g;
    category.appendChild(opt);
  });

  cards.forEach((card, i) => {
    const summary = card.querySelector('summary');
    if (summary && !summary.querySelector('.number')) {
      const num = document.createElement('span');
      num.className = 'number';
      num.textContent = String(i + 1);
      summary.insertBefore(num, summary.firstChild);
    }
    summary?.classList.add('memory-table-summary');
  });

  const vault = document.createElement('div');
  vault.className = 'memory-table-vault db-table-vault';
  vault.hidden = true;
  moveAllCardsToVault(cards, vault);
  catalog.appendChild(vault);

  ['trace-tables', 'memory-tables', 'operations-tables'].forEach((id) => {
    const sec = main.querySelector(`#${id}`);
    if (sec) {
      const h2 = sec.querySelector(':scope > h2');
      if (h2) h2.hidden = true;
    }
  });

  ingested.addEventListener(
    'toggle',
    (e) => {
      const card = e.target;
      if (card?.matches?.('details.memory-table-card, details.table-card') && card.open) {
        attachPrismaTableCardEnhancements(card);
      }
    },
    true
  );

  catalog.querySelector('.db-split')?.remove();
  const split = document.createElement('div');
  split.className = 'db-split';
  split.innerHTML =
    '<aside class="db-side" aria-label="Tables"><div class="db-side-list"></div></aside>' +
    '<section class="db-detail" aria-live="polite"><div class="db-detail-mount"></div></section>';
  ingested.insertAdjacentElement('beforebegin', split);
  const sideList = split.querySelector('.db-side-list');
  const detailMount = split.querySelector('.db-detail-mount');
  let activeCard = null;

  function selectCard(card) {
    if (activeCard && activeCard !== card) {
      activeCard.classList.remove('db-table-detail-mode');
      vault.appendChild(activeCard);
    }
    activeCard = card;
    if (!card) {
      detailMount.innerHTML = '<p class="db-ingested-empty note">No tables match. Try clearing search or choosing All groups.</p>';
      return;
    }
    card.classList.add('db-table-detail-mode');
    card.open = true;
    detailMount.replaceChildren(card);
    detailMount.scrollTop = 0;
    attachPrismaTableCardEnhancements(card);
    sideList.querySelectorAll('.db-side-row').forEach((row) => {
      const on = row.dataset.id === card.id;
      row.classList.toggle('is-active', on);
      if (on) row.scrollIntoView({ block: 'nearest' });
    });
  }

  function renderSideList(matched) {
    sideList.innerHTML = '';
    matched.forEach((card) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'db-side-row';
      row.dataset.id = card.id;
      row.innerHTML = '<span class="db-side-name"></span><span class="db-side-model"></span>';
      row.querySelector('.db-side-name').textContent = card.dataset.tableName;
      row.querySelector('.db-side-model').textContent = card.dataset.category || '';
      row.addEventListener('click', () => selectCard(card));
      sideList.appendChild(row);
    });
  }

  const byCat = new Map();
  cards.forEach((card) => {
    const cat = card.dataset.category || 'Memory tables';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(card);
  });

  function getFilters() {
    return {
      q: search.value.toLowerCase().trim(),
      c: category.value,
    };
  }

  function matchingCards() {
    const { q, c } = getFilters();
    return cards.filter(
      (card) => (!q || card.dataset.search.includes(q)) && (!c || card.dataset.category === c)
    );
  }

  function syncCategoryPills() {
    const { c } = getFilters();
    categoryPills.querySelectorAll('[data-cat]').forEach((btn) => {
      const val = btn.getAttribute('data-cat') || '';
      btn.classList.toggle('is-active', val === (c || ''));
      btn.setAttribute('aria-pressed', val === (c || '') ? 'true' : 'false');
    });
  }

  function buildCategoryPills() {
    categoryPills.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'db-cat-pill is-active';
    allBtn.dataset.cat = '';
    allBtn.textContent = `All (${cards.length})`;
    allBtn.setAttribute('aria-pressed', 'true');
    allBtn.addEventListener('click', () => {
      category.value = '';
      onFilterChange();
    });
    categoryPills.appendChild(allBtn);
    for (const [cat, catCards] of byCat) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'db-cat-pill';
      btn.dataset.cat = cat;
      btn.textContent = `${cat} (${catCards.length})`;
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', () => {
        category.value = cat;
        onFilterChange();
        catalog.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      categoryPills.appendChild(btn);
    }
  }

  function syncCatalogChrome(shown) {
    root.classList.remove('memory-catalog-detail-open', 'memory-catalog-master-detail');
    root.dataset.memorySubview = 'browse';
    document.getElementById('dedicated-view')?.classList.remove('memory-tables-table-page');
    if (emptyStackMsg) emptyStackMsg.hidden = shown > 0;
    const titleEl = document.getElementById('dedicated-title');
    if (titleEl) {
      titleEl.innerHTML = '<i class="fas fa-database mr-2 text-[#7c3aed]"></i>Memory DB Tables';
    }
  }

  function renderTableList() {
    const matched = matchingCards();
    count.textContent = `${matched.length} of ${cards.length} tables`;
    renderSideList(matched);
    if (!activeCard || !matched.includes(activeCard)) selectCard(matched[0] || null);
    else selectCard(activeCard);
    syncCatalogChrome(matched.length);
    syncCategoryPills();
  }

  function onFilterChange() {
    renderTableList();
  }

  function resetFilters() {
    search.value = '';
    category.value = '';
    onFilterChange();
  }

  root.querySelector('#memory-open-reference')?.addEventListener('click', () => {
    const ref = main.querySelector('#memorydb-reference-depth');
    if (ref) {
      ref.open = true;
      ref.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  search.addEventListener('input', onFilterChange);
  category.addEventListener('change', onFilterChange);
  catalog.querySelector('#memory-clear-filters')?.addEventListener('click', resetFilters);

  root.querySelector('nav.memorydb-nav')?.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href')?.slice(1);
      if (!id) return;
      e.preventDefault();
      const el = root.querySelector('#' + CSS.escape(id));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  buildCategoryPills();

  root.classList.add('memorydb-ready', 'memory-catalog-ingested-mode', 'dbguide-nested');
  renderTableList();

  requestAnimationFrame(() => {
    const dedView = document.getElementById('dedicated-view');
    if (dedView) dedView.scrollTop = 0;
    main.scrollTo(0, 0);
  });
}

function mountMemoryDbCatalogStudio(root, hooks) {
  if (!root || root.dataset.memoryStudioMounted === '1') return;
  root.dataset.memoryStudioMounted = '1';
  const resetFilters = hooks?.resetFilters;

  const layout = root.querySelector('.memorydb-layout');
  if (!layout) return;

  let toolbar = root.querySelector('.memory-studio-toolbar');
  if (!toolbar) {
    toolbar = document.createElement('header');
    toolbar.className = 'db-studio-toolbar memory-studio-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.innerHTML =
      '<div class="db-studio-toolbar-left">' +
      '<button type="button" class="db-studio-btn" id="memory-catalog-exit" title="Back to System overview"><i class="fas fa-arrow-left" aria-hidden="true"></i><span>Overview</span></button>' +
      '<button type="button" class="db-studio-btn" id="memory-toggle-rail" aria-expanded="false"><i class="fas fa-list" aria-hidden="true"></i><span>Section index</span></button>' +
      '</div>' +
      '<div class="db-studio-toolbar-center">' +
      '<span class="db-studio-kicker">Memory data dictionary</span>' +
      '<strong class="db-studio-title">12 tables · 3 groups</strong>' +
      '</div>' +
      '<div class="db-studio-toolbar-right">' +
      '<button type="button" class="db-studio-btn db-studio-btn-ghost" data-memory-jump="database-tables">Full Prisma catalog</button>' +
      '<button type="button" class="db-studio-btn db-studio-btn-accent" id="memory-open-overview-toolbar">Overview sections</button>' +
      '</div>';
    root.insertBefore(toolbar, layout);
  }

  const railBackdrop = document.createElement('div');
  railBackdrop.className = 'db-studio-rail-backdrop memory-studio-rail-backdrop';
  railBackdrop.hidden = true;
  if (!root.querySelector('.memory-studio-rail-backdrop')) {
    layout.insertBefore(railBackdrop, layout.firstChild);
  }

  toolbar.querySelector('#memory-catalog-exit')?.addEventListener('click', () => {
    if (typeof showOverview === 'function') showOverview(true);
  });
  toolbar.querySelector('#memory-toggle-rail')?.addEventListener('click', () => {
    const on = root.classList.toggle('memory-rail-open');
    toolbar.querySelector('#memory-toggle-rail')?.setAttribute('aria-expanded', on ? 'true' : 'false');
    railBackdrop.hidden = !on;
  });
  railBackdrop.addEventListener('click', () => {
    root.classList.remove('memory-rail-open');
    toolbar.querySelector('#memory-toggle-rail')?.setAttribute('aria-expanded', 'false');
    railBackdrop.hidden = true;
  });
  toolbar.querySelector('#memory-open-overview-toolbar')?.addEventListener('click', () => {
    root.querySelector('#memory-open-overview')?.click();
  });
  toolbar.querySelectorAll('[data-memory-jump]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-memory-jump');
      if (key && typeof showDedicatedPage === 'function') showDedicatedPage(key);
    });
  });

  root.addEventListener('memory-catalog-home', () => {
    if (typeof resetFilters === 'function') resetFilters();
  });
}

function initSelfImprovingGuidePage(root) {
  if (!root) return;
  const activate = initModTabGuide(root, 'sim', 'overview', () => {
    try {
      root.querySelectorAll(__aloftMermaidSelector()).forEach((el) => {
        if (!el.dataset.mermaidSrc) {
          const code = (el.textContent || '').trim();
          if (code) el.dataset.mermaidSrc = code;
        }
      });
      if (window.mermaid) {
        root.querySelectorAll(__aloftMermaidSelector()).forEach((el) => {
          el.removeAttribute('data-processed');
          const raw = el.dataset.mermaidSrc || (el.textContent || '').trim();
          if (raw) el.textContent = raw;
          mermaid.run({ nodes: [el] }).catch(() => {});
        });
      }
    } catch (e) {
      /* ignore */
    }
  });

  window.__simActivateTab = activate;

}

function upgradeLegacyAreaTabs(root) {
  const configs = [
    { selector: '.exp-area', prefix: 'exp', defaultId: 'exp-overview' },
    { selector: '.mem-area', prefix: 'mem', defaultId: 'mem-pipe' },
    { selector: '.job-stage', prefix: 'job', defaultId: null },
  ];
  for (const cfg of configs) {
    const areas = root.querySelectorAll(cfg.selector);
    if (!areas.length || root.querySelector(`[data-legacy-tabs="${cfg.prefix}"]`)) continue;
    const nav = document.createElement('div');
    nav.className = 'mod-tab-buttons mb-3';
    nav.setAttribute('data-legacy-tabs', cfg.prefix);
    areas.forEach((area, i) => {
      const id = area.id || `${cfg.prefix}-${i}`;
      area.id = id;
      area.classList.add('mod-panel');
      if (cfg.defaultId === id || (!cfg.defaultId && i === 0)) {
        area.classList.add('mod-panel-active');
      } else {
        area.style.display = '';
      }
      const label =
        area.getAttribute('data-tab-label') ||
        id.replace(/^(exp|mem|job)-/, '').replace(/-/g, ' ');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mod-tab-link' + (area.classList.contains('mod-panel-active') ? ' mod-tab-active' : '');
      btn.textContent = label.charAt(0).toUpperCase() + label.slice(1);
      btn.addEventListener('click', () => {
        areas.forEach((a) => {
          a.classList.remove('mod-panel-active');
          a.style.display = '';
        });
        area.classList.add('mod-panel-active');
        nav.querySelectorAll('.mod-tab-link').forEach((b) => b.classList.remove('mod-tab-active'));
        btn.classList.add('mod-tab-active');
      });
      nav.appendChild(btn);
    });
    areas[0].parentNode.insertBefore(nav, areas[0]);
  }
}

function wrapGuidePageHero(page) {
  if (
    !page ||
    page.querySelector('.guide-page-hero') ||
    page.classList.contains('dbguide-dedicated') ||
    page.classList.contains('memorydb-dedicated')
  ) {
    return;
  }
  const h1 = page.querySelector(':scope > h1');
  if (!h1) return;

  const hero = document.createElement('header');
  hero.className = 'guide-page-hero';
  hero.innerHTML =
    '<div class="guide-page-hero-glow" aria-hidden="true"></div><div class="guide-page-hero-inner"></div>';
  const inner = hero.querySelector('.guide-page-hero-inner');
  h1.parentNode.insertBefore(hero, h1);

  const prev = hero.previousElementSibling;
  if (
    prev &&
    prev.classList &&
    (prev.classList.contains('flex') || prev.classList.contains('mb-4') || prev.classList.contains('mb-3'))
  ) {
    inner.appendChild(prev);
  }
  inner.appendChild(h1);
  const sub = hero.nextElementSibling;
  if (sub && sub.tagName === 'P' && sub.classList.contains('text-lg')) {
    inner.appendChild(sub);
  }

  inner.querySelectorAll('[class*="rounded-full"]').forEach((chip) => {
    const cls = chip.className || '';
    if (cls.includes('bg-white') && !cls.includes('text-[')) {
      chip.classList.add('guide-hero-chip', 'text-[#003262]');
    }
  });
}

function polishGuidePage(body, pageKey) {
  if (!body) return;
  const page =
    body.querySelector(
      '#semantic-guide-root, #harvest-guide-root, #agentmem-guide-root, #sim-guide-root, #dbguide-root, #memorydb-guide-root, .dedicated-page'
    ) || body.firstElementChild;
  if (!page || page.dataset.guidePolished === '1') return;
  page.dataset.guidePolished = '1';
  page.classList.add('guide-page-polished', 'arch-module-rich');
  wrapGuidePageHero(page);
  page.querySelectorAll('.dedicated-section').forEach((sec) => sec.classList.add('guide-section-card'));
  body.setAttribute('data-guide-page', pageKey || '');
}

function enrichArchModulePage(pageKey, body) {
  const embedded = body.querySelector(
    '#semantic-guide-root, #harvest-guide-root, #agentmem-guide-root, #sim-guide-root, #dbguide-root, #memorydb-guide-root'
  );
  if (embedded) {
    polishGuidePage(body, pageKey);
    return;
  }

  const page = body.querySelector('.dedicated-page');
  if (!page || page.dataset.archRichEnriched === '1') return;
  page.classList.add('arch-module-rich');
  page.dataset.archRichEnriched = '1';

  const h1 = page.querySelector('h1');
  if (!h1) return;

  const hasPath =
    page.querySelector('.inspector-reading-path, .mod-intro, .simple-explain');
  const sections = page.querySelectorAll('.dedicated-section h3');
  if (sections.length >= 2 && !hasPath) {
    const intro = document.createElement('div');
    intro.className = 'mod-intro';
    intro.innerHTML =
      '<strong>How to read this page:</strong> Use the section list below to jump to each topic. Open collapsed <em>deep dive</em> blocks for implementation detail.';
    h1.insertAdjacentElement('afterend', intro);
  }

  const willAutoTab =
    page.dataset.enableSectionTabs === 'true' && sections.length >= 2;
  if (willAutoTab) page.querySelector('.mod-toc')?.remove();
  if (sections.length >= 3 && !page.querySelector('.mod-toc') && !willAutoTab) {
    const toc = document.createElement('nav');
    toc.className = 'mod-toc';
    toc.setAttribute('aria-label', 'On this page');
    const items = [];
    sections.forEach((h3, i) => {
      const id = `mod-sec-${pageKey}-${i}`;
      const section = h3.closest('.dedicated-section') || h3.parentElement;
      if (section && !section.id) section.id = id;
      const text = h3.textContent.replace(/\s+/g, ' ').trim();
      items.push(`<li><a href="#${section?.id || id}">${text}</a></li>`);
    });
    toc.innerHTML = `<strong>On this page</strong><ul>${items.join('')}</ul>`;
    const anchor = page.querySelector('.simple-explain, .mod-intro, h1');
    anchor.insertAdjacentElement('afterend', toc);
  }

  const headerKeep = (el) =>
    el &&
    (el.classList?.contains('simple-explain') ||
      el.classList?.contains('inspector-reading-path') ||
      el.classList?.contains('inspector-page-lead') ||
      el.classList?.contains('mod-intro') ||
      el.classList?.contains('mod-toc') ||
      (el.tagName === 'P' && el.classList?.contains('text-lg')));

  const mainBlocks = [];
  let node = h1.nextElementSibling;
  while (node) {
    if (node.classList?.contains('repo-doc-panel')) break;
    if (node.classList?.contains('mod-guide-body')) break;
    if (headerKeep(node)) {
      node = node.nextElementSibling;
      continue;
    }
    mainBlocks.push(node);
    node = node.nextElementSibling;
  }
  if (mainBlocks.length && !page.querySelector('.mod-guide-body')) {
    const wrap = document.createElement('div');
    wrap.className = 'mod-guide-body';
    mainBlocks[0].parentNode.insertBefore(wrap, mainBlocks[0]);
    mainBlocks.forEach((el) => wrap.appendChild(el));
  }

  upgradeLegacyAreaTabs(page);
  // Long module pages (Marcus, Bandits, History, etc.) must stay fully scrollable.
  // Auto-tabs hid non-active panels and looked like empty pages when the first tab was only a diagram.
  if (page.dataset.enableSectionTabs === 'true') {
    autoTabifyModuleSections(page, pageKey);
  }
  polishGuidePage(body, pageKey);
}

/* FOER / AI-Agent-Memory embedded guide — Play flow + mini-cards (used from architecture-guide.html) */
const __agentMemFlowTimers = {};

function playFlow(id) {
  resetFlow(id);
  const root = document.getElementById(id);
  if (!root) return;
  const steps = root.querySelectorAll('.flow-step');
  let i = 0;
  __agentMemFlowTimers[id] = setInterval(() => {
    if (i < steps.length) {
      steps[i].classList.add('on');
      steps[i].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      i++;
    } else clearInterval(__agentMemFlowTimers[id]);
  }, 800);
}

function resetFlow(id) {
  clearInterval(__agentMemFlowTimers[id]);
  const root = document.getElementById(id);
  if (!root) return;
  root.querySelectorAll('.flow-step').forEach((s) => s.classList.remove('on'));
}

function toggleMini(card) {
  if (!card) return;
  const was = card.classList.contains('open');
  const parent = card.parentElement;
  if (parent) parent.querySelectorAll('.mini-card').forEach((c) => c.classList.remove('open'));
  if (!was) card.classList.add('open');
}

function initAgentMemInteractive(root) {
  if (!root || root.dataset.agentMemInteractive === '1') return;
  root.dataset.agentMemInteractive = '1';
  root.querySelectorAll('.flow').forEach((flow) => {
    const id = flow.id;
    if (!id) return;
    flow.querySelectorAll('.flow-step').forEach((step) => {
      step.style.cursor = 'pointer';
      step.addEventListener('click', () => {
        resetFlow(id);
        step.classList.add('on');
      });
    });
  });
}

const __ARCH_PILLARS = [
  {
    id: 'build',
    label: 'Build',
    icon: 'fa-hammer',
    accent: '#1e40af',
    soft: '#dbeafe',
    summary: 'Where people work day to day.',
    bullets: [
      'Inspector — conversational analytics workbench',
      'Dashboards — pinned governed analytics',
      'Teach, Bandits, History — learning and replay',
    ],
    page: 'inspector',
  },
  {
    id: 'memory',
    label: 'Memory',
    icon: 'fa-brain',
    accent: '#6d28d9',
    soft: '#f3e8ff',
    summary: 'What the org remembers between sessions.',
    bullets: [
      'FOER bullets inject into prompts',
      'Teach and synthesis improve recall',
      'Marcus and contributions track authors',
    ],
    page: 'memory-foer',
  },
  {
    id: 'estate',
    label: 'Estate',
    icon: 'fa-layer-group',
    accent: '#b45309',
    soft: '#fef3c7',
    summary: 'Warehouse inventory and harvest pipeline.',
    bullets: [
      'Jobs T0–T3 on Fargate',
      'Catalog, entities, mapper, lineage',
      'Feeds harvested Inspector context',
    ],
    page: 'estate-overview',
  },
  {
    id: 'govern',
    label: 'Govern',
    icon: 'fa-shield-alt',
    accent: '#6b21a8',
    soft: '#f3e8ff',
    summary: 'Who can do what; audit trail.',
    bullets: ['Users and RBAC', 'Policies', 'Audit log and docs catalog'],
    page: 'govern-users',
  },
  {
    id: 'cross',
    label: 'Cross-cutting',
    icon: 'fa-project-diagram',
    accent: '#0d9488',
    soft: '#ccfbf1',
    summary: 'Shared brains under every feature.',
    bullets: ['Semantic layer', 'Data Studio', 'Auth, Marcus, harvester docs'],
    page: 'semantic',
  },
  {
    id: 'run',
    label: 'Run',
    icon: 'fa-cloud',
    accent: '#0369a1',
    soft: '#e0f2fe',
    summary: 'How the app is hosted and wired.',
    bullets: ['Beanstalk web tier', 'Aurora state', 'Databricks + LLM providers'],
    page: 'platform-deploy',
  },
];

const __ARCH_MODULES = [
  { page: 'inspector', label: 'Inspector', group: 'build' },
  { page: 'dashboards', label: 'Analytics dashboards', group: 'build' },
  { page: 'dashboard', label: 'Home dashboard', group: 'build' },
  { page: 'metrics', label: 'Metrics', group: 'build' },
  { page: 'teach', label: 'Teach', group: 'build' },
  { page: 'performance-lab', label: 'Performance Lab', group: 'build' },
  { page: 'bandits', label: 'Bandits', group: 'build' },
  { page: 'history', label: 'History', group: 'build' },
  { page: 'memory-overview', label: 'Memory overview', group: 'memory' },
  { page: 'memory-foer', label: 'FOER / AI memory', group: 'memory' },
  { page: 'memory-ops', label: 'FOER Ops', group: 'memory' },
  { page: 'memory-contrib', label: 'Contributions', group: 'memory' },
  { page: 'self-improving-memory', label: 'Self-improving memory', group: 'memory' },
  { page: 'estate-overview', label: 'Estate health', group: 'estate' },
  { page: 'estate-catalog', label: 'Catalog', group: 'estate' },
  { page: 'estate-entities', label: 'Entities', group: 'estate' },
  { page: 'estate-lineage', label: 'Lineage', group: 'estate' },
  { page: 'estate-jobs', label: 'Jobs', group: 'estate' },
  { page: 'estate-mapper', label: 'Mapper', group: 'estate' },
  { page: 'estate-silo', label: 'Silo Finder', group: 'estate' },
  { page: 'estate-object', label: 'Object detail', group: 'estate' },
  { page: 'govern-users', label: 'Users', group: 'govern' },
  { page: 'govern-policies', label: 'Policies', group: 'govern' },
  { page: 'govern-audit', label: 'Audit log', group: 'govern' },
  { page: 'govern-docs', label: 'Docs catalog', group: 'govern' },
  { page: 'semantic', label: 'Semantic layer', group: 'cross' },
  { page: 'studio', label: 'Data Studio', group: 'cross' },
  { page: 'auth', label: 'Auth and RBAC', group: 'cross' },
  { page: 'marcus', label: 'Marcus / Workbench', group: 'cross' },
  { page: 'harvester', label: 'Harvesting guide', group: 'cross' },
  { page: 'harvester-pipeline', label: 'Harvester pipeline', group: 'cross' },
  { page: 'scenarios', label: 'Scenarios', group: 'cross' },
  { page: 'platform-architecture', label: 'Interactive architecture', group: 'cross' },
  { page: 'repo-documentation', label: 'Repo docs hub', group: 'repo' },
  { page: 'platform-deploy', label: 'Deployment and AWS', group: 'repo' },
  { page: 'external-apis', label: 'External APIs', group: 'repo' },
  { page: 'creating-agents', label: 'Creating agents', group: 'repo' },
  { page: 'inspector-context-modes', label: 'Inspector context modes', group: 'repo' },
  { page: 'memory-database-tables', label: 'Memory DB tables', group: 'repo' },
  { page: 'database-tables', label: 'All DB tables', group: 'repo' },
];

const __ARCH_PERSONAS = {
  analyst: {
    text: 'Start with <button type="button">Inspector turn</button> tab, then open ',
    pages: ['inspector', 'dashboards', 'semantic', 'history'],
  },
  engineer: {
    text: 'Start with <button type="button">New data path</button>, then ',
    pages: ['harvester', 'estate-jobs', 'estate-catalog', 'platform-deploy'],
  },
  steward: {
    text: 'Open <strong>Platform map</strong> → Govern + Memory, then ',
    pages: ['semantic', 'govern-policies', 'memory-ops', 'govern-audit'],
  },
  ops: {
    text: 'Read <strong>Runtime stack</strong>, then ',
    pages: ['platform-deploy', 'external-apis', 'database-tables', 'govern-audit'],
  },
};

const __ARCH_QUIZ = [
  {
    q: 'Where do long T0–T3 harvest jobs usually run?',
    choices: [
      { id: 'a', text: 'Only inside the Beanstalk web container' },
      { id: 'b', text: 'ECS Fargate harvester tasks' },
      { id: 'c', text: 'Only in the browser' },
    ],
    answer: 'b',
  },
  {
    q: 'What does FOER memory mainly provide to Inspector?',
    choices: [
      { id: 'a', text: 'Raw warehouse credentials' },
      { id: 'b', text: 'Org-specific rules and recall bullets in the prompt' },
      { id: 'c', text: 'Replacement for the semantic layer' },
    ],
    answer: 'b',
  },
  {
    q: 'Harvested Inspector context mode depends on…',
    choices: [
      { id: 'a', text: 'Catalog artifacts and embeddings from the estate pipeline' },
      { id: 'b', text: 'Only static PDF uploads' },
      { id: 'c', text: 'GitHub pull requests' },
    ],
    answer: 'a',
  },
  {
    q: 'Primary app state (sessions, catalog, memory) lives in…',
    choices: [
      { id: 'a', text: 'Databricks only' },
      { id: 'b', text: 'Aurora PostgreSQL' },
      { id: 'c', text: 'Browser localStorage only' },
    ],
    answer: 'b',
  },
];

const __archFlowTimers = {};

function playArchFlow(flowId) {
  resetArchFlow(flowId);
  const root = document.getElementById(flowId);
  if (!root) return;
  const steps = root.querySelectorAll('.flow-step');
  let i = 0;
  __archFlowTimers[flowId] = setInterval(() => {
    if (i < steps.length) {
      steps[i].classList.add('on');
      steps[i].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      i++;
    } else clearInterval(__archFlowTimers[flowId]);
  }, 700);
}

function resetArchFlow(flowId) {
  clearInterval(__archFlowTimers[flowId]);
  const root = document.getElementById(flowId);
  if (!root) return;
  root.querySelectorAll('.flow-step').forEach((s) => s.classList.remove('on'));
}

const __ARCH_SERVICES = [
  { id: 'aurora', label: 'Aurora Postgres', sub: 'App state', icon: 'fa-database', accent: '#0369a1', soft: '#e0f2fe',
    summary: 'Primary application database.',
    bullets: ['Sessions, users, agent runs, catalog artifacts', 'Memory bullets and vector embeddings (pgvector)', 'Everything the web app and harvester persist'],
    page: 'database-tables', pageLabel: 'All database tables' },
  { id: 'databricks', label: 'Databricks SQL', sub: 'Warehouse', icon: 'fa-warehouse', accent: '#b45309', soft: '#fef3c7',
    summary: 'The customer data warehouse.',
    bullets: ['Inspector runs read-only SQL here', 'Harvester reads table metadata and samples', 'Never written to by the app'],
    page: 'external-apis', pageLabel: 'External APIs and providers' },
  { id: 'llm', label: 'Bedrock + Azure AI', sub: 'LLMs and embeddings', icon: 'fa-robot', accent: '#6d28d9', soft: '#f3e8ff',
    summary: 'Model providers.',
    bullets: ['Agent loop and tool calls', 'Titan / embedding models for memory and catalog search', 'Keys live in .env only, never in this guide'],
    page: 'external-apis', pageLabel: 'External APIs and providers' },
  { id: 'fargate', label: 'Fargate harvester', sub: 'Long jobs', icon: 'fa-cubes', accent: '#0d9488', soft: '#ccfbf1',
    summary: 'Runs the T0–T3 harvest pipeline.',
    bullets: ['Started by the app (RunTask) or on a schedule', 'Inventory, profile, enrich, embed', 'Writes catalog artifacts to Aurora'],
    page: 'harvester-pipeline', pageLabel: 'Harvester pipeline' },
  { id: 'eventbridge', label: 'EventBridge', sub: 'Schedules', icon: 'fa-clock', accent: '#1e40af', soft: '#dbeafe',
    summary: 'Time-based triggers.',
    bullets: ['Schedules harvest and sweep runs', 'Starts Fargate tasks without a user click'],
    page: 'platform-deploy', pageLabel: 'Deployment and AWS' },
];

const __ARCH_JOURNEYS = {
  ask: {
    label: 'Ask a question',
    steps: [
      { title: 'You ask', text: 'Type a question in Inspector. Pick harvested catalog or warehouse-only context.', lit: ['users', 'build'] },
      { title: 'Ground', text: 'The semantic layer resolves metrics, FOER memory injects org rules, and catalog search finds tables.', lit: ['cross', 'memory', 'aurora'] },
      { title: 'Agent loop', text: 'The LLM calls tools and runs read-only SQL on Databricks. Progress streams back to the page.', lit: ['build', 'llm', 'databricks'] },
      { title: 'Present', text: 'Data Studio profiles the rows and picks a chart. The trajectory shows the SQL as proof.', lit: ['cross', 'build'] },
      { title: 'Persist', text: 'The session is saved to History. Async traces feed learning and bandits.', lit: ['aurora', 'memory'] },
    ],
  },
  data: {
    label: 'Add new data',
    steps: [
      { title: 'Register', text: 'Add a source connection and enqueue a harvest job (T0 inventory through T3 embed).', lit: ['estate', 'aurora'] },
      { title: 'Run', text: 'A Fargate worker reads Databricks and writes catalog artifacts to Aurora. EventBridge can schedule it.', lit: ['fargate', 'eventbridge', 'databricks', 'aurora'] },
      { title: 'Curate', text: 'Stewards review the catalog, entities, mapper and lineage.', lit: ['estate', 'govern'] },
      { title: 'Define', text: 'Promote metrics and models in the semantic layer so answers use governed definitions.', lit: ['cross'] },
      { title: 'Ask', text: 'Harvested Inspector mode now searches the new embeddings and catalog.', lit: ['build', 'llm', 'aurora'] },
    ],
  },
};

function initPlatformArchitectureGuide(root) {
  if (!root || root.dataset.archGuideInit === '1') return;
  root.dataset.archGuideInit = '1';

  const open = (page) => {
    if (page && typeof showDedicatedPage === 'function') showDedicatedPage(page);
  };
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const items = new Map();
  __ARCH_PILLARS.forEach((p) => items.set(p.id, { ...p, kind: 'pillar' }));
  __ARCH_SERVICES.forEach((p) => items.set(p.id, { ...p, kind: 'service' }));

  root.innerHTML = `
    <header class="arc-head">
      <h1>Platform architecture</h1>
      <p>How ALOFT fits together. <strong>Click any block</strong> to see what it does, or <strong>follow a request</strong> below to watch it light up.</p>
    </header>
    <div class="arc-layout">
      <section class="arc-diagram" aria-label="Architecture diagram">
        <div class="arc-node arc-static" data-key="users"><i class="fas fa-user"></i><b>Users</b><span>Browser over HTTPS</span></div>
        <div class="arc-link">▼</div>
        <div class="arc-app">
          <div class="arc-app-title"><i class="fas fa-server"></i> ALOFT web app <span>Next.js on Elastic Beanstalk</span></div>
          <div class="arc-grid" id="arc-pillars"></div>
        </div>
        <div class="arc-link">▼ reads / writes</div>
        <div class="arc-app arc-app-services">
          <div class="arc-app-title"><i class="fas fa-cloud"></i> Backing services</div>
          <div class="arc-grid arc-grid-5" id="arc-services"></div>
        </div>
      </section>
      <aside class="arc-panel" id="arc-panel" aria-live="polite"></aside>
    </div>
    <section class="arc-journey" aria-label="Follow a request">
      <div class="arc-journey-head">
        <h2>Follow a request</h2>
        <div class="arc-seg" id="arc-seg"></div>
      </div>
      <ol class="arc-steps" id="arc-steps"></ol>
      <div class="arc-step-card" id="arc-step-card"></div>
      <div class="arc-step-ctl">
        <button type="button" id="arc-prev">← Back</button>
        <button type="button" id="arc-play" class="primary">▶ Play</button>
        <button type="button" id="arc-next">Next →</button>
      </div>
    </section>
    <footer class="arc-foot">
      <button type="button" data-go="">System overview</button>
      <button type="button" data-go="scenarios">Scenario walkthroughs</button>
      <button type="button" data-go="repo-documentation">Repo docs hub</button>
    </footer>`;

  const modulesFor = (it) => {
    const group = it.id === 'run' ? 'repo' : it.id;
    return it.kind === 'pillar' ? __ARCH_MODULES.filter((m) => m.group === group) : [];
  };

  const mkNode = (it, host) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'arc-node';
    b.dataset.key = it.id;
    b.style.setProperty('--acc', it.accent);
    b.style.setProperty('--soft', it.soft);
    b.innerHTML = `<i class="fas ${it.icon}"></i><b>${esc(it.label)}</b><span>${esc(it.sub || it.summary)}</span>`;
    b.addEventListener('click', () => { stopPlay(); select(it.id); });
    host.appendChild(b);
  };
  __ARCH_PILLARS.forEach((p) => mkNode(p, root.querySelector('#arc-pillars')));
  __ARCH_SERVICES.forEach((p) => mkNode(p, root.querySelector('#arc-services')));

  const panel = root.querySelector('#arc-panel');
  function select(key) {
    const it = items.get(key);
    root.querySelectorAll('.arc-node').forEach((n) => n.classList.toggle('is-selected', n.dataset.key === key));
    if (!it) return;
    panel.style.setProperty('--acc', it.accent);
    const mods = modulesFor(it);
    panel.innerHTML = `
      <div class="arc-panel-kicker">${it.kind === 'pillar' ? 'Pillar' : 'Service'}</div>
      <h3><i class="fas ${it.icon}"></i> ${esc(it.label)}</h3>
      <p class="arc-panel-sum">${esc(it.summary)}</p>
      <ul>${it.bullets.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      ${mods.length ? `<div class="arc-panel-mods">${mods.map((m) => `<button type="button" data-page="${m.page}">${esc(m.label)}</button>`).join('')}</div>` : ''}
      <button type="button" class="arc-open" data-page="${it.page}">Open ${esc(it.pageLabel || it.label)} guide →</button>`;
    panel.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => open(b.dataset.page)));
  }

  panel.innerHTML = '<div class="arc-panel-kicker">Details</div><h3>Select a block</h3><p class="arc-panel-sum">Click any pillar or service in the diagram.</p>';

  let journey = 'ask';
  let step = 0;
  let timer = null;
  const seg = root.querySelector('#arc-seg');
  const stepsEl = root.querySelector('#arc-steps');
  const card = root.querySelector('#arc-step-card');
  const playBtn = root.querySelector('#arc-play');

  function stopPlay() {
    clearInterval(timer);
    timer = null;
    playBtn.textContent = '▶ Play';
  }
  function paintStep() {
    const j = __ARCH_JOURNEYS[journey];
    stepsEl.querySelectorAll('li').forEach((li, i) => {
      li.classList.toggle('is-active', i === step);
      li.classList.toggle('is-done', i < step);
    });
    const st = j.steps[step];
    card.innerHTML = `<span class="arc-step-n">${step + 1}</span><div><strong>${esc(st.title)}</strong><p>${esc(st.text)}</p></div>`;
    root.querySelectorAll('.arc-node').forEach((n) => n.classList.toggle('is-lit', st.lit.includes(n.dataset.key)));
    root.querySelector('#arc-prev').disabled = step === 0;
    root.querySelector('#arc-next').disabled = step === j.steps.length - 1;
  }
  function paintJourney() {
    const j = __ARCH_JOURNEYS[journey];
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b.dataset.j === journey));
    stepsEl.innerHTML = j.steps.map((st, i) => `<li><button type="button" data-i="${i}"><i>${i + 1}</i>${esc(st.title)}</button></li>`).join('');
    stepsEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { stopPlay(); step = Number(b.dataset.i); paintStep(); }));
    paintStep();
  }
  Object.entries(__ARCH_JOURNEYS).forEach(([k, j]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.j = k;
    b.textContent = j.label;
    b.addEventListener('click', () => { stopPlay(); journey = k; step = 0; paintJourney(); });
    seg.appendChild(b);
  });
  root.querySelector('#arc-prev').addEventListener('click', () => { stopPlay(); step = Math.max(0, step - 1); paintStep(); });
  root.querySelector('#arc-next').addEventListener('click', () => { stopPlay(); step = Math.min(__ARCH_JOURNEYS[journey].steps.length - 1, step + 1); paintStep(); });
  playBtn.addEventListener('click', () => {
    if (timer) { stopPlay(); return; }
    step = 0;
    paintStep();
    playBtn.textContent = '❚❚ Pause';
    timer = setInterval(() => {
      if (step >= __ARCH_JOURNEYS[journey].steps.length - 1) { stopPlay(); return; }
      step += 1;
      paintStep();
    }, 1600);
  });
  root.querySelectorAll('.arc-foot [data-go]').forEach((b) => b.addEventListener('click', () => {
    const g = b.dataset.go;
    if (!g) { if (typeof showOverview === 'function') showOverview(true); } else open(g);
  }));

  paintJourney();
  select('build');
}

if (typeof window !== 'undefined') {
  window.playFlow = playFlow;
  window.resetFlow = resetFlow;
  window.toggleMini = toggleMini;
  window.initAgentMemInteractive = initAgentMemInteractive;
  window.playArchFlow = playArchFlow;
  window.resetArchFlow = resetArchFlow;
  window.initPlatformArchitectureGuide = initPlatformArchitectureGuide;
  window.polishGuidePage = polishGuidePage;
}
