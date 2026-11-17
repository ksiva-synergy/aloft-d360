/**
 * Generate docs/powerbi-module-layered-guide.html from powerbi-module-layered-guide.md
 * Run: node scripts/docs/build-pbi-layered-guide-html.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const mdPath = path.join(root, "docs/powerbi-module-layered-guide.md");
const dataPath = path.join(root, "docs/powerbi-data-formats-and-fields.md");
const outPath = path.join(root, "docs/powerbi-module-layered-guide.html");

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
  t = t.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return t;
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
      out.push(`<h1 class="doc-title">${inlineMd(line.slice(2))}</h1>`);
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      const text = line.slice(3);
      const id = slugify(text);
      if (embed) {
        sectionIds.push({ level: 3, id, text });
        out.push(`<h3 class="embed-h3" id="data-${id}">${inlineMd(text)}</h3>`);
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
      const prefix = embed ? "data-" : "sec-";
      const tag = embed ? "h4" : "h3";
      sectionIds.push({ level: embed ? 4 : 3, id, text });
      out.push(`<${tag} id="${prefix}${id}">${inlineMd(text)}</${tag}>`);
      i++;
      continue;
    }
    if (line.startsWith("#### ")) {
      const text = line.slice(5);
      const id = slugify(text);
      const prefix = embed ? "data-" : "sec-";
      out.push(`<h4 id="${prefix}${id}">${inlineMd(text)}</h4>`);
      i++;
      continue;
    }
    if (line.trim() === "---") {
      out.push('<hr class="section-rule" />');
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
      if (lang === "mermaid") {
        out.push('<div class="mermaid-wrap"><pre class="mermaid">' + code + "</pre></div>");
      } else {
        out.push(`<pre class="schema-block">${code}</pre>`);
      }
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
      out.push(
        "<thead><tr>" + header.map((h) => `<th>${inlineMd(h)}</th>`).join("") + "</tr></thead><tbody>"
      );
      for (const row of rows) {
        while (row.length < header.length) row.push("");
        out.push("<tr>" + row.map((c) => `<td>${inlineMd(c)}</td>`).join("") + "</tr>");
      }
      out.push("</tbody></table></div>");
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      out.push('<ol class="detail-list">');
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        out.push(`<li>${inlineMd(lines[i].replace(/^\d+\.\s/, ""))}</li>`);
        i++;
      }
      out.push("</ol>");
      continue;
    }
    if (/^-\s/.test(line)) {
      out.push('<ul class="detail-list">');
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
    if (line.startsWith("**Audience:**") || line.startsWith("**Status:**")) {
      out.push(`<p class="meta-line">${inlineMd(line)}</p>`);
      i++;
      continue;
    }
    out.push(`<p>${inlineMd(line)}</p>`);
    i++;
  }
  closeSection();
  return { html: out.join("\n"), sectionIds };
}

const md = fs.readFileSync(mdPath, "utf8");
const dataMd = fs.existsSync(dataPath) ? fs.readFileSync(dataPath, "utf8") : "";
const { html: bodyHtml, sectionIds } = parseMarkdownFixed(md);
const { html: dataHtml } = dataMd ? parseMarkdownFixed(dataMd, { embed: true }) : { html: "" };

const navLinks = [
  { href: "#overview-quick", label: "Quick overview" },
  { href: "#layer-stack", label: "Layer stack diagram" },
  { href: "#data-formats", label: "Data formats & fields" },
  ...sectionIds.filter((s) => s.level === 2).map((s) => ({ href: `#sec-${s.id}`, label: s.text })),
  { href: "powerbi-harvest-overview.html", label: "Design spec (HTML)", external: true },
  { href: "powerbi-recreation-architecture.md", label: "Recreation L0–L6 (MD)", external: true },
];

const sidebarNav = navLinks
  .map((l) => {
    if (l.external) {
      return `<a href="${l.href}" class="sub">${escapeHtml(l.label)}</a>`;
    }
    return `<a href="${l.href}">${escapeHtml(l.label)}</a>`;
  })
  .join("\n      ");

const template = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ALOFT — Power BI module (layers, APIs, examples)</title>
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
    .hero p { margin: 0.35rem 0 0; opacity: 0.92; }
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
    code { font-family: var(--mono); font-size: 0.8rem; }
    pre, .schema-block {
      font-family: var(--mono);
      font-size: 0.8rem;
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
    .doc-title { display: none; }
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
      <a class="back" href="powerbi-module-layered-guide.md">← Markdown source</a>
      <h2>Navigate</h2>
      ${sidebarNav}
    </nav>
    <main class="content">
      <header class="hero">
        <span class="badge">IMPLEMENTED</span>
        <span class="badge">LAYERED GUIDE</span>
        <h1>Power BI module — how we built it</h1>
        <p>UI, Aloft APIs, harvest jobs, <code>src/lib/powerbi</code>, Aurora tables, Microsoft REST/Fabric, and Inspector — with examples and APIs we chose not to use.</p>
        <p style="font-size:0.85rem;opacity:0.8;margin-top:0.75rem;">Generated from <code>docs/powerbi-module-layered-guide.md</code> · <code>node scripts/docs/build-pbi-layered-guide-html.mjs</code></p>
      </header>

      <div class="overview-quick" id="overview-quick">
        <h2>Quick overview</h2>
        <p><strong>Harvest</strong> (inventory → definitions → parse) pulls TMDL/PBIR into Aurora and raw store. <strong>Link</strong> binds tables to Unity Catalog. <strong>Recreation</strong> (translate → oracle → parity → publish) produces <code>kb_verified_queries</code> for Inspector. Operators use <strong>Estate → Power BI</strong> and Jobs; agents never see raw TMDL.</p>
        <p>Pilot result: <strong>Vessel Internal Audit</strong> — 63/73 measures published with parity (see recreation doc).</p>
      </div>

      <section id="layer-stack">
        <h2 style="font-size:1.35rem;color:var(--navy);border-bottom:2px solid var(--gold);padding-bottom:0.35rem;">Application layers</h2>
        <div class="mermaid-wrap">
          <pre class="mermaid">
flowchart TB
  subgraph UI["Layer B — Estate UI"]
    PBI_PAGE["powerbi.tsx"]
    COMP["Graph, sources, pipeline"]
  end
  subgraph API["Layer C — Next.js APIs"]
    ROUTES["/api/agent-lab/powerbi/*"]
  end
  subgraph JOBS["Layer D — Harvester jobs"]
    INV["pbi_inventory"] --> DEF["pbi_definitions"] --> PAR["pbi_parse"]
    PAR --> LINK["pbi_catalog_link"] --> TR["pbi_translate"]
    TR --> ORA["pbi_oracle"] --> PA["pbi_parity"] --> PUB["pbi_publish"]
  end
  subgraph LIB["Layer E — src/lib/powerbi"]
    MS["client.ts + fabric.ts"]
    CMP["dax-sql-compile.ts"]
  end
  subgraph DATA["Layer F — Storage"]
    PG["pbi_* Aurora"]
    VQ["kb_verified_queries"]
    RAW["TMDL raw store"]
  end
  PBI_PAGE --> ROUTES
  ROUTES --> PG
  JOBS --> LIB
  LIB --> MS
  LIB --> CMP
  DEF --> RAW
  PUB --> VQ
          </pre>
        </div>
        <div class="callout"><strong>Regenerate:</strong> after editing the markdown, run <code>node scripts/docs/build-pbi-layered-guide-html.mjs</code>. Product design spec remains in <a href="powerbi-harvest-overview.html">powerbi-harvest-overview.html</a>.</div>
      </section>

      <div class="callout" style="margin-bottom:2rem;">
        <strong>Full guide</strong> — sections below mirror <a href="powerbi-module-layered-guide.md">powerbi-module-layered-guide.md</a> (2026-11-16).
      </div>

      ${bodyHtml}

      <section class="detail-section" id="data-formats">
        <h2>Power BI data: formats, fields, and use</h2>
        <p class="meta-line">From <a href="powerbi-data-formats-and-fields.md">powerbi-data-formats-and-fields.md</a> — what we download (JSON, TMDL, PBIR), which fields land in which tables, and how recreation uses them.</p>
        <div class="embed-body">
        ${dataHtml}
        </div>
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