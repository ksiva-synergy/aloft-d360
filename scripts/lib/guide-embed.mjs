/**
 * Shared helpers for inlining standalone HTML guides into architecture-guide.html.
 */
import fs from 'fs';

export function scopeCss(css, scope) {
  const chunks = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') {
      depth--;
      if (depth === 0) {
        chunks.push(css.slice(start, i + 1));
        start = i + 1;
      }
    }
  }
  return chunks
    .map((chunk) => {
      const m = chunk.match(/^([\s\S]*?)\{([\s\S]*)\}$/);
      if (!m) return '';
      const prelude = m[1].trim();
      const body = m[2];
      if (!prelude) return '';
      if (prelude.startsWith('@media')) {
        return `${prelude}{${scopeCss(body, scope)}}`;
      }
      if (prelude.startsWith('@')) return chunk;
      if (/\.(layout|sidebar|top-bar)\b/.test(prelude) || prelude.includes('.back')) return '';
      const scopedPrelude = prelude
        .split(',')
        .map((sel) => {
          sel = sel.trim();
          if (!sel) return '';
          if (sel === 'body' || sel.startsWith('body ') || sel === '*') return '';
          if (sel.startsWith(scope)) return sel;
          return `${scope} ${sel}`;
        })
        .filter(Boolean)
        .join(', ');
      if (!scopedPrelude) return '';
      return `${scopedPrelude}{${body}}`;
    })
    .filter(Boolean)
    .join('\n');
}

export function extractStyleBlock(html) {
  const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!styleMatch) throw new Error('No <style> block in guide');
  return styleMatch[1];
}

export function extractMainSections(html) {
  const mainMatch = html.match(/<main class="content">([\s\S]*)<\/main>/);
  if (!mainMatch) throw new Error('No <main class="content"> in guide');
  const main = mainMatch[1];
  const sections = [];
  const re = /<section id="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g;
  let m;
  while ((m = re.exec(main))) {
    sections.push({ id: m[1], html: m[0] });
  }
  return sections;
}

export function extractPanelBlocks(html, panelIdPrefix = 'panel-') {
  const panels = [];
  const re = new RegExp(
    `<div class="panel(?: active)?" id="${panelIdPrefix}([^"]+)"[^>]*>([\\s\\S]*?)<\\/div>\\s*(?=<div class="panel|<script)`,
    'g'
  );
  let m;
  while ((m = re.exec(html))) {
    panels.push({ id: m[1], html: m[0] });
  }
  if (panels.length === 0) {
    throw new Error(`No panels with prefix ${panelIdPrefix} found`);
  }
  return panels;
}

export function buildTabPanels({ scopeClass, panelPrefix, groups, sectionsById, panelsById }) {
  return groups
    .map((g, idx) => {
      let inner = '';
      if (g.ids) {
        inner = g.ids.map((id) => sectionsById.get(id) || '').join('\n');
      } else if (g.panelIds) {
        inner = g.panelIds.map((id) => panelsById.get(id) || '').join('\n');
      }
      const active = idx === 0 ? ' mod-panel-active' : '';
      return `<div class="mod-panel${active}" id="${panelPrefix}-panel-${g.tab}" data-mod-tab="${g.tab}">\n${inner}\n</div>`;
    })
    .join('\n');
}

export function buildTabNav(groups, panelPrefix) {
  const flat = groups.flatMap((g) => ({ tab: g.tab, label: g.label, group: g.group }));
  const byGroup = new Map();
  for (const item of flat) {
    const key = item.group || 'Topics';
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(item);
  }
  let html = `<nav class="mod-tab-nav" aria-label="Module sections">\n`;
  html += `<p class="mod-tab-nav-title">Pick a topic — content changes below</p>\n<div class="mod-tab-groups">\n`;
  for (const [label, items] of byGroup) {
    html += `<div class="mod-tab-group"><p class="mod-tab-group-label">${label}</p><div class="mod-tab-buttons">\n`;
    for (const item of items) {
      const active = item === flat[0] ? ' mod-tab-active' : '';
      html += `<button type="button" class="mod-tab-link${active}" data-mod-tab="${item.tab}">${item.label}</button>\n`;
    }
    html += `</div></div>\n`;
  }
  html += `</div></nav>\n`;
  return html;
}

export function escapeTemplateLiteral(s) {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

export function extractLayoutGuide(html) {
  const navMatch = html.match(/<nav[^>]*>([\s\S]*?)<\/nav>/);
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/i);
  if (!mainMatch) throw new Error('No <main> in layout guide');
  return {
    navHtml: navMatch ? navMatch[1].trim() : '',
    mainHtml: mainMatch[1].trim(),
    script: scriptMatch ? scriptMatch[1].trim() : '',
  };
}

export function sanitizeEmbeddedNav(navHtml, backPageKey = 'self-improving-memory') {
  return navHtml
    .replace(
      /<a[^>]*class="back"[^>]*href="[^"]*"[^>]*>[^<]*<\/a>/i,
      `<button type="button" class="back" onclick="showDedicatedPage('${backPageKey}')">← Back in architecture guide</button>`
    )
    .replace(/<a([^>]*)\s+href="[^"]*\.html"([^>]*)>/gi, (m, a, b) => {
      if (/self-improving/i.test(m)) {
        return `<button type="button" class="back" onclick="showDedicatedPage('self-improving-memory')">← Self-improving memory guide</button>`;
      }
      return m;
    });
}

export function insertPageBefore(arch, pageKey, blockInner, beforeKey) {
  const beforeMarker = `      '${beforeKey}': \``;
  const idx = arch.indexOf(beforeMarker);
  if (idx < 0) throw new Error(`insertPageBefore: marker not found for ${beforeKey}`);
  const wrapped = `      '${pageKey}': \`\n` + escapeTemplateLiteral(blockInner) + `\n      \`,\n\n`;
  return arch.slice(0, idx) + wrapped + arch.slice(idx);
}

export function replacePageBlock(arch, pageKey, nextKey, blockInner) {
  const startMarker = `      '${pageKey}': \``;
  const endMarker = `      '${nextKey}': \``;
  const startIdx = arch.indexOf(startMarker);
  const endIdx = arch.indexOf(endMarker);
  if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
    throw new Error(`Markers not found for page ${pageKey} → ${nextKey}`);
  }
  const wrapped =
    `      '${pageKey}': \`\n` + escapeTemplateLiteral(blockInner) + `\n      \`,\n\n`;
  return arch.slice(0, startIdx) + wrapped + arch.slice(endIdx);
}

export function appendScopedCss(cssPath, scopeClass, rawCss, extra = '') {
  let scoped =
    `\n/* ${scopeClass} — generated */\n` +
    `${scopeClass} {
  --navy: #003262; --gold: #FDB515; --bg: #f8f6f1; --surface: #fff;
  --text: #1a2332; --muted: #5a6578; --border: #e2ddd3;
  --radius: 12px;
  --mono: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 0.95rem;
  line-height: 1.65;
  color: var(--text);
}\n` +
    scopeCss(rawCss.replace(/:root\s*\{[\s\S]*?\}/g, ''), scopeClass) +
    extra;
  const existing = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
  const marker = `/* ${scopeClass} — generated */`;
  if (existing.includes(marker)) {
    const re = new RegExp(`\\n?\\/\\* ${scopeClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — generated \\*/[\\s\\S]*?(?=\\n\\/\\* |$)`, 'g');
    fs.writeFileSync(cssPath, existing.replace(re, scoped.trimStart()) + '\n');
  } else {
    fs.writeFileSync(cssPath, existing + scoped);
  }
}
