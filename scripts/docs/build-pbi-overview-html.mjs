/**
 * One-off generator: merges build plan markdown into powerbi-harvest-overview.html
 * Run: node scripts/docs/build-pbi-overview-html.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const planPath = path.join(root, "docs/powerbi-harvest-build-plan.md");
const trackerPath = path.join(root, "docs/jobs/powerbi-implementation-tracker.md");
const schemaPath = path.join(root, "docs/powerbi-semantic-schema.md");
const outPath = path.join(root, "docs/powerbi-harvest-overview.html");

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMd(s) {
  let t = escapeHtml(s);
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return t;
}

function parseMarkdown(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  const sectionIds = [];

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("# ")) {
      out.push(`<h1 id="${slugify(line.slice(2))}">${inlineMd(line.slice(2))}</h1>`);
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      const text = line.slice(3);
      const id = slugify(text);
      sectionIds.push({ level: 2, id, text });
      out.push(`<section class="detail-section" id="${id}"><h2>${inlineMd(text)}</h2>`);
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      const text = line.slice(4);
      const id = slugify(text);
      sectionIds.push({ level: 3, id, text });
      out.push(`<h3 id="${id}">${inlineMd(text)}</h3>`);
      i++;
      continue;
    }
    if (line.trim() === "---") {
      out.push("<hr class=\"section-rule\" />");
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      i++;
      const codeLines = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      const code = escapeHtml(codeLines.join("\n"));
      if (lang === "text" || !lang) {
        out.push(`<pre class="schema-block">${code}</pre>`);
      } else {
        out.push(`<pre><code>${code}</code></pre>`);
      }
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && /^\|[\s\-:|]+\|/.test(lines[i + 1])) {
      const header = line.split("|").filter((c, idx, arr) => idx > 0 && idx < arr.length - 1).map((c) => c.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && !lines[i].startsWith("```")) {
        const cells = lines[i]
          .split("|")
          .filter((c, idx, arr) => idx > 0 && idx < arr.length - 1)
          .map((c) => c.trim());
        if (cells.length) rows.push(cells);
        i++;
      }
      out.push('<div class="table-scroll"><table>');
      out.push("<thead><tr>" + header.map((h) => `<th>${inlineMd(h)}</th>`).join("") + "</tr></thead>");
      out.push("<tbody>");
      for (const row of rows) {
        out.push(
          "<tr>" +
            row.map((c, ci) => `<td>${inlineMd(c)}</td>`).join("") +
            "</tr>"
        );
      }
      out.push("</tbody></table></div>");
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      out.push("<ol class=\"detail-list\">");
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        out.push(`<li>${inlineMd(lines[i].replace(/^\d+\.\s/, ""))}</li>`);
        i++;
      }
      out.push("</ol>");
      continue;
    }
    if (line.startsWith("- ")) {
      out.push("<ul class=\"detail-list\">");
      while (i < lines.length && (lines[i].startsWith("- ") || lines[i].startsWith("  - "))) {
        const content = lines[i].replace(/^[\s]*-\s/, "");
        out.push(`<li>${inlineMd(content)}</li>`);
        i++;
      }
      out.push("</ul>");
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (line.startsWith("**Status:**") || line.startsWith("**Supersedes**") || line.startsWith("**Branch:**")) {
      out.push(`<p class="meta-line">${inlineMd(line)}</p>`);
      i++;
      continue;
    }
    out.push(`<p>${inlineMd(line)}</p>`);
    i++;
  }

  // Close open sections (naive: close before each new h2 — sections opened on ##)
  let html = out.join("\n");
  const parts = html.split(/<section class="detail-section"/);
  if (parts.length > 1) {
    const rebuilt = [parts[0]];
    for (let p = 1; p < parts.length; p++) {
      rebuilt.push('<section class="detail-section"' + parts[p]);
    }
    html = rebuilt.join("");
    html = html.replace(/(<section class="detail-section"[^>]*>)/g, (m, _g, offset) => {
      return m;
    });
    // Close sections: split by h2 sections
    const segs = html.split(/(?=<section class="detail-section")/);
    html = segs
      .map((seg, idx) => {
        if (idx === 0) return seg;
        if (!seg.includes("</section>")) return seg + "</section>";
        return seg;
      })
      .join("");
    for (let p = 1; p < segs.length; p++) {
      if (!segs[p].endsWith("</section>")) segs[p] += "</section>";
    }
    html = segs.join("");
  }

  return { html, sectionIds };
}

function parseMarkdownFixed(md, opts = {}) {
  const { embed = false } = opts;
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  const sectionIds = [];
  let inSection = false;

  const closeSection = () => {
    if (inSection) {
      out.push("</section>");
      inSection = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("# ") && !line.startsWith("## ")) {
      closeSection();
      if (!embed) out.push(`<h1 class="doc-title">${inlineMd(line.slice(2))}</h1>`);
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      const text = line.slice(3);
      const id = slugify(text);
      if (embed) {
        sectionIds.push({ level: 3, id, text });
        out.push(`<h3 class="embed-h3" id="tracker-${id}">${inlineMd(text)}</h3>`);
      } else {
        closeSection();
        sectionIds.push({ level: 2, id, text });
        out.push(`<section class="detail-section" id="sec-${id}"><h2>${inlineMd(text)}</h2>`);
        inSection = true;
      }
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      const text = line.slice(4);
      const id = slugify(text);
      const prefix = embed ? "tracker-" : "sec-";
      const tag = embed ? "h4" : "h3";
      sectionIds.push({ level: embed ? 4 : 3, id, text });
      out.push(`<${tag} id="${prefix}${id}">${inlineMd(text)}</${tag}>`);
      i++;
      continue;
    }
    if (line.trim() === "---") {
      out.push("<hr class=\"section-rule\" />");
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      i++;
      const codeLines = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      out.push(`<pre class="schema-block">${escapeHtml(codeLines.join("\n"))}</pre>`);
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && /^\|[\s\-:|]+\|/.test(lines[i + 1])) {
      const header = line
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && !/^\|[\s\-:|]+\|$/.test(lines[i])) {
        const cells = lines[i]
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim());
        rows.push(cells);
        i++;
      }
      out.push('<div class="table-scroll"><table>');
      out.push("<thead><tr>" + header.map((h) => `<th>${inlineMd(h)}</th>`).join("") + "</tr></thead><tbody>");
      for (const row of rows) {
        while (row.length < header.length) row.push("");
        out.push("<tr>" + row.map((c) => `<td>${inlineMd(c)}</td>`).join("") + "</tr>");
      }
      out.push("</tbody></table></div>");
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      out.push("<ol class=\"detail-list\">");
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        out.push(`<li>${inlineMd(lines[i].replace(/^\d+\.\s/, ""))}</li>`);
        i++;
      }
      out.push("</ol>");
      continue;
    }
    if (/^-\s/.test(line)) {
      out.push("<ul class=\"detail-list\">");
      while (i < lines.length && /^-\s/.test(lines[i])) {
        out.push(`<li>${inlineMd(lines[i].replace(/^-\s/, ""))}</li>`);
        i++;
      }
      out.push("</ul>");
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    out.push(`<p>${inlineMd(line)}</p>`);
    i++;
  }
  if (!embed) closeSection();
  return { html: out.join("\n"), sectionIds };
}

const planMd = fs.readFileSync(planPath, "utf8");
const trackerMd = fs.readFileSync(trackerPath, "utf8");
const schemaMd = fs.readFileSync(schemaPath, "utf8");

const { html: planHtml, sectionIds } = parseMarkdownFixed(planMd);
const { html: trackerHtml } = parseMarkdownFixed(trackerMd, { embed: true });
const { html: schemaHtml } = parseMarkdownFixed(schemaMd, { embed: true });

const navLinks = [
  { href: "#overview-quick", label: "Quick overview" },
  { href: "#flow", label: "End-to-end diagram" },
  ...sectionIds
    .filter((s) => s.level === 2)
    .map((s) => ({
      href: `#sec-${s.id}`,
      label: s.text,
      sub: false,
    })),
  { href: "#impl-tracker", label: "Implementation tracker" },
  { href: "#offline-scripts", label: "Offline scripts (schema doc)" },
];

const sidebarNav = `
      <a class="back" href="powerbi-harvest-build-plan.md">← Markdown build plan</a>
      <h2>Navigate</h2>
      ${navLinks
        .map(
          (l) =>
            `<a href="${l.href}"${l.sub ? ' class="sub"' : ""}>${escapeHtml(l.label)}</a>`
        )
        .join("\n      ")}
`;

const template = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ALOFT — Power BI Semantic Bridge (complete guide)</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    :root {
      --navy: #003262;
      --gold: #FDB515;
      --pbi: #f2c811;
      --bg: #f8f6f1;
      --surface: #fff;
      --text: #1a2332;
      --muted: #5a6578;
      --border: #e2ddd3;
      --ok: #166534;
      --ok-bg: #dcfce7;
      --warn-bg: #fef3c7;
      --pending-bg: #dbeafe;
      --radius: 12px;
      --mono: Consolas, "IBM Plex Mono", ui-monospace, monospace;
    }
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.65;
      margin: 0;
    }
    .layout { display: flex; min-height: 100vh; }
    .sidebar {
      width: 300px;
      flex-shrink: 0;
      background: var(--navy);
      color: #fff;
      padding: 1rem 0;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
      font-size: 0.88rem;
    }
    .sidebar h2 {
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.65;
      padding: 0.5rem 1.25rem;
      margin-top: 0.75rem;
    }
    .sidebar a {
      display: block;
      padding: 0.35rem 1.25rem;
      color: rgba(255,255,255,0.85);
      text-decoration: none;
      border-left: 3px solid transparent;
    }
    .sidebar a:hover { background: rgba(255,255,255,0.08); color: #fff; }
    .sidebar a.sub { padding-left: 2rem; font-size: 0.82rem; opacity: 0.9; }
    .sidebar .back {
      border-bottom: 1px solid rgba(255,255,255,0.15);
      margin-bottom: 0.5rem;
      padding-bottom: 0.75rem;
      color: var(--gold);
      font-weight: 600;
    }
    .content { flex: 1; max-width: 1100px; padding: 2rem 2.5rem 5rem; }
    .hero {
      background: linear-gradient(135deg, #1a1a2e 0%, var(--navy) 55%, #0d3d56 100%);
      color: #fff;
      padding: 2rem 2.5rem;
      margin: -2rem -2.5rem 2rem;
      border-radius: 0 0 var(--radius) var(--radius);
      border-bottom: 4px solid var(--pbi);
    }
    .hero h1 { font-size: 1.65rem; margin: 0 0 0.5rem; }
    .hero p { margin: 0; opacity: 0.92; }
    .badge {
      display: inline-block;
      background: var(--pbi);
      color: #1a1a2e;
      font-size: 0.68rem;
      font-weight: 700;
      padding: 0.2rem 0.55rem;
      border-radius: 999px;
      margin-right: 0.35rem;
    }
    .detail-section {
      margin-bottom: 2.75rem;
      scroll-margin-top: 1rem;
    }
    .detail-section > h2 {
      font-size: 1.4rem;
      color: var(--navy);
      border-bottom: 2px solid var(--gold);
      padding-bottom: 0.35rem;
      margin: 0 0 1rem;
    }
    .detail-section h3, .embed-h3 {
      font-size: 1.08rem;
      color: var(--navy);
      margin: 1.5rem 0 0.6rem;
    }
    .detail-section h4 { font-size: 0.98rem; color: var(--navy); margin: 1rem 0 0.5rem; }
    .detail-section p, .overview-quick p { color: var(--muted); margin: 0.6rem 0; }
    .meta-line { font-size: 0.9rem; color: var(--muted) !important; }
    .detail-list { color: var(--muted); margin: 0.5rem 0 1rem 1.5rem; }
    .detail-list li { margin-bottom: 0.35rem; }
    .table-scroll { overflow-x: auto; margin: 0.75rem 0 1.25rem; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.84rem;
      min-width: 480px;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 0.45rem 0.6rem;
      text-align: left;
      vertical-align: top;
    }
    th { background: #f0ebe3; font-weight: 600; }
    code, .schema-block {
      font-family: var(--mono);
      font-size: 0.8rem;
    }
    pre, .schema-block {
      background: #1a2332;
      color: #e8e4dc;
      padding: 1rem;
      border-radius: 8px;
      overflow-x: auto;
      margin: 0.75rem 0 1rem;
      white-space: pre-wrap;
    }
    .mermaid-wrap {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem;
      margin: 1rem 0;
      overflow-x: auto;
    }
    .callout {
      background: var(--pending-bg);
      border: 1px solid #93c5fd;
      border-radius: var(--radius);
      padding: 1rem 1.25rem;
      margin: 1rem 0;
      font-size: 0.95rem;
    }
    .section-rule { border: none; border-top: 1px dashed var(--border); margin: 1.5rem 0; }
    .overview-quick {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.25rem 1.5rem;
      margin-bottom: 2rem;
    }
    .overview-quick h2 { margin-top: 0; font-size: 1.2rem; color: var(--navy); }
    a { color: #1e40af; }
    @media (max-width: 960px) {
      .layout { flex-direction: column; }
      .sidebar { width: 100%; height: auto; position: relative; max-height: 40vh; }
      .content { padding: 1rem; }
      .hero { margin: 0 0 1.5rem; padding: 1.5rem; }
    }
  </style>
</head>
<body>
  <div class="layout">
    <nav class="sidebar" aria-label="Table of contents">
${sidebarNav}
    </nav>
    <main class="content">
      <header class="hero">
        <span class="badge">COMPLETE GUIDE</span>
        <span class="badge">POWER BI BRIDGE</span>
        <h1>Power BI Semantic Bridge — full design &amp; implementation</h1>
        <p>Everything from the approved build plan, plus implementation tracker and offline script notes. Read the quick overview first, then scroll for full tables and specifications.</p>
      </header>

      <div class="overview-quick" id="overview-quick">
        <h2>Quick overview</h2>
        <p><strong>Databricks catalog</strong> = structure and joins. <strong>Power BI</strong> = business meaning (measures, filters, M transforms). ALOFT harvests Power BI read-only, translates DAX to SQL, proves parity against Power BI numbers, stewards approve, then Inspector and agents use <strong>verified queries</strong> and existing <code>platform_sem_*</code> — not a second semantic layer.</p>
        <p>Example: <em>“What was vessel OPEX last quarter against budget?”</em> — no report name; domain routing → approved metric → SQL + provenance.</p>
        <p>Estate scale: <strong>503</strong> models, <strong>494</strong> reports, <strong>3</strong> workspaces in scope. Pilot: <strong>CII</strong> then <strong>Finance</strong>.</p>
      </div>

      <section id="flow">
        <h2 style="font-size:1.35rem;color:var(--navy);border-bottom:2px solid var(--gold);padding-bottom:0.35rem;">End-to-end flow</h2>
        <div class="mermaid-wrap">
          <pre class="mermaid">
flowchart LR
  PBI["Power BI"] --> INV["pbi_inventory"] --> DEF["pbi_definitions"] --> PARSE["pbi_parse"]
  PARSE --> LINK["pbi_catalog_link"]
  PARSE --> TR["pbi_translate"]
  DB["Databricks catalog"] -.-> LINK
  PBI -.-> ORA["pbi_oracle"]
  ORA --> PA["pbi_parity"]
  TR --> PA --> RQ["Review queue"]
  RQ --> PUB["pbi_publish"] --> VQ["kb_verified_queries"] --> INS["Inspector"]
          </pre>
        </div>
        <div class="callout"><strong>Light pass:</strong> all models — inventory, definitions, parse, link, domains. <strong>Deep pass:</strong> pilot families — reports, cards, oracle, translate, parity, publish.</div>
      </section>

      <div class="callout" style="margin-bottom:2rem;">
        <strong>Full specification</strong> — sections below are generated from <code>docs/powerbi-harvest-build-plan.md</code> (design approved 2026-11-11).
      </div>

      ${planHtml}

      <section class="detail-section" id="impl-tracker">
        <h2>Implementation tracker (branch)</h2>
        <div class="embed-body">
        ${trackerHtml}
        </div>
      </section>

      <section class="detail-section" id="offline-scripts">
        <h2>Offline scripts &amp; APIs</h2>
        <p class="meta-line">Full text from <code>docs/powerbi-semantic-schema.md</code> — validation and scripts used before in-app harvest. Regenerate this page after editing the markdown: <code>node scripts/docs/build-pbi-overview-html.mjs</code>.</p>
        <div class="embed-body">
        ${schemaHtml}
        </div>
        <p><a href="powerbi-semantic-schema.md">Markdown source</a> · <a href="powerbi-harvest-build-plan.md">Build plan markdown</a></p>
      </section>
    </main>
  </div>
  <script>
    mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "loose" });
  </script>
</body>
</html>
`;

fs.writeFileSync(outPath, template, "utf8");
console.log("Wrote", outPath, "(" + template.length + " chars)");
