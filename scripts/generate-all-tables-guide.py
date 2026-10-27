"""Generate the complete Prisma table data dictionary for ALOFT D360.

Usage:
    python scripts/generate-all-tables-guide.py

The generated documentation is intentionally based on prisma/schema.prisma so
the inventory does not drift when models are added or renamed.
"""

from __future__ import annotations

import html
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "prisma" / "schema.prisma"
OUTPUT = ROOT / "docs" / "all-database-tables-guide.html"


PURPOSES = {
    "User": "Application users and authentication identity.",
    "UserProfile": "User profile and login activity summary.",
    "LoginEvent": "Successful and failed authentication events.",
    "PlatformAgentMemory": "Reusable operating-memory rules, including vector embeddings.",
    "PlatformTraceNode": "Individual agent execution events used for trace reconstruction.",
    "PlatformTraceEdge": "Relationships between trace events.",
    "PlatformMemoryInjection": "Audit of memory bullets injected into an agent run.",
    "PlatformMemoryContribution": "User contribution events used by reputation scoring.",
    "PlatformUserReputation": "Contributor reputation by organisation and domain.",
    "PlatformMemorySynthesisRun": "Summary of a memory synthesis sweep.",
    "PlatformMemorySynthesisDetail": "Per-session results within a synthesis sweep.",
    "PlatformMemoryTopic": "FOER task-signature topic classification.",
    "PlatformTeachCandidate": "Review envelope for a user-taught memory rule.",
    "PlatformMarcusReflection": "Optional post-run Marcus reflection input to synthesis.",
    "PlatformJobRun": "Operational status and heartbeat for memory DAG jobs.",
    "PlatformContextEmbedding": "Embeddings for harvested context objects.",
    "PlatformNlIntentEmbedding": "Embeddings for natural-language intent retrieval.",
}


def parse_models(text: str) -> list[dict]:
    matches = list(re.finditer(r"(?m)^model\s+([A-Za-z0-9_]+)\s*\{", text))
    models: list[dict] = []
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        block = text[start:end]
        map_match = re.search(r'@@map\("([^"]+)"\)', block)
        fields = []
        for line in block.splitlines():
            line = line.split("//", 1)[0].strip()
            if not line or line.startswith("@@") or line.startswith("///"):
                continue
            field = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s+([^\s]+)(?:\s+(.*))?$", line)
            if not field:
                continue
            name, type_name, attributes = field.groups()
            if name in {"model", "enum"}:
                continue
            attributes = attributes or ""
            if type_name.endswith("[]") or type_name.startswith("Unsupported"):
                field_kind = "array" if type_name.endswith("[]") else "vector"
            elif type_name == "Json":
                field_kind = "json"
            else:
                field_kind = "relational"
            fields.append({
                "name": name,
                "type": type_name,
                "attributes": attributes,
                "kind": field_kind,
            })
        model_name = match.group(1)
        table_name = map_match.group(1) if map_match else model_name
        models.append({
            "model": model_name,
            "table": table_name,
            "fields": fields,
        })
    return models


def category(table: str) -> str:
    lower = table.lower()
    if lower.startswith(("platform_memory", "platform_agent_memory", "platform_trace", "platform_marcus", "platform_teach", "platform_user_reputation")):
        return "Self-improving memory"
    if lower.startswith(("platform_context", "knowledge_", "platform_estate", "schema_catalog")):
        return "Context and data estate"
    if lower.startswith(("agent_lab", "platform_eval", "platform_fixture", "platform_redteam", "platform_routing", "platform_acceptance", "bandit_", "platform_boost")):
        return "Agent evaluation and quality"
    if lower.startswith(("platform_dashboard", "platform_chart", "platform_charts", "platform_sem_")):
        return "Semantic layer and dashboards"
    if lower.startswith(("backfill_", "vessels")):
        return "Backfill and vessel data"
    if lower.startswith(("role", "permission", "user_role", "user_session", "session", "action", "audit", "llm_call")):
        return "Identity, access, and audit"
    if lower.startswith(("platform_watch", "platform_remediation", "platform_pipeline", "healing", "hitl", "policy", "environment")):
        return "Operations and governance"
    if lower.startswith(("agent_", "tool_", "prompt_", "bus_", "catalog_", "deployment", "budget", "pipeline_")):
        return "Agent platform configuration"
    return "Application and platform data"


def purpose(model: str, table: str) -> str:
    if model in PURPOSES:
        return PURPOSES[model]
    lower = table.lower().replace("_", " ")
    return f"Stores {lower} records used by the ALOFT D360 platform."


def sample_value(field: dict) -> str:
    name = field["name"].lower()
    type_name = field["type"]
    if field["kind"] == "vector":
        return "[0.021, -0.348, 0.771, ...]"
    if field["kind"] == "json":
        return '{"example": "value"}'
    if field["kind"] == "array":
        return '["example_001", "example_002"]'
    if type_name == "Boolean":
        return "true"
    if type_name == "Int":
        return "42"
    if type_name in {"Float", "Decimal"}:
        return "12.5"
    if type_name == "DateTime":
        return "2026-09-30T10:00:00Z"
    if name == "email":
        return "analyst@example.com"
    if name.endswith("_id") or name == "id":
        return "example_01hxyz"
    if "status" in name:
        return "ACTIVE"
    if "name" in name or "title" in name:
        return "Example record"
    if "count" in name or "rank" in name or "index" in name:
        return "1"
    return "Example text"


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def camel_case(model: str) -> str:
    return model[:1].lower() + model[1:]


def scan_runtime_usage(models: list[dict]) -> None:
    """Annotate models with references found in runtime source code."""
    files = []
    for root in (ROOT / "src", ROOT / "scripts"):
        if not root.exists():
            continue
        files.extend(
            path for path in root.rglob("*")
            if path.is_file()
            and not any(part in {"node_modules", ".next", "dist", "build", ".git"} for part in path.parts)
            and path.name != Path(__file__).name
            and path.suffix.lower() in {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".sql"}
        )

    sources = []
    for path in files:
        try:
            sources.append((path, path.read_text(encoding="utf-8", errors="ignore")))
        except OSError:
            pass

    for item in models:
        terms = sorted(
            {item["table"], item["model"], camel_case(item["model"])},
            key=len,
            reverse=True,
        )
        references = []
        for path, source in sources:
            if any(
                re.search(rf"(?<![A-Za-z0-9_]){re.escape(term)}(?![A-Za-z0-9_])", source)
                for term in terms
                if len(term) >= 3
            ):
                references.append(path.relative_to(ROOT).as_posix())
        item["usage_files"] = sorted(set(references))


def render_table(item: dict, number: int) -> str:
    vector = any(field["kind"] == "vector" for field in item["fields"])
    json_field = any(field["kind"] == "json" for field in item["fields"])
    arrays = any(field["kind"] == "array" for field in item["fields"])
    badges = []
    if vector:
        badges.append('<span class="pill vector">VECTOR</span>')
    if json_field:
        badges.append('<span class="pill json">JSON</span>')
    if arrays:
        badges.append('<span class="pill array">ARRAY</span>')
    if not badges:
        badges.append('<span class="pill relational">RELATIONAL</span>')
    usage_files = item.get("usage_files", [])
    if usage_files:
        badges.append(f'<span class="pill used">USED IN SOURCE ({len(usage_files)})</span>')
        usage_text = (
            f'<span class="usage used-text">Referenced in {len(usage_files)} source files: '
            f'{esc(", ".join(usage_files[:5]))}{" …" if len(usage_files) > 5 else ""}</span>'
        )
        usage_status = "used"
    else:
        badges.append('<span class="pill schema-only">SCHEMA ONLY</span>')
        usage_text = '<span class="usage schema-text">No direct reference found in src/ or scripts/</span>'
        usage_status = "schema-only"
    rows = "".join(
        "<tr>"
        f"<td><code>{esc(field['name'])}</code></td>"
        f"<td><code>{esc(field['type'])}</code></td>"
        f"<td>{esc(field['attributes'])}</td>"
        f"<td><span class=\"type-{field['kind']}\">{esc(field['kind'])}</span></td>"
        f"<td><code>{esc(sample_value(field))}</code></td>"
        "</tr>"
        for field in item["fields"]
    )
    return f"""
    <details class="table-card" data-usage="{usage_status}" data-category="{esc(category(item['table']))}" data-search="{esc(item['table'] + ' ' + item['model'] + ' ' + category(item['table']) + ' ' + purpose(item['model'], item['table']) + ' ' + ' '.join(usage_files))}">
      <summary>
        <span class="number">{number}</span>
        <span class="table-name">{esc(item['table'])}</span>
        <span class="model-name">{esc(item['model'])}</span>
        {' '.join(badges)}
      </summary>
      <div class="table-body">
        <p><strong>Purpose:</strong> {esc(purpose(item['model'], item['table']))}</p>
        <p><strong>Category:</strong> {esc(category(item['table']))} · <strong>Columns:</strong> {len(item['fields'])}</p>
        <p><strong>Current project usage:</strong> {usage_text}</p>
        <table>
          <thead><tr><th>Column</th><th>Prisma type</th><th>Attributes</th><th>Storage kind</th><th>Illustrative sample</th></tr></thead>
          <tbody>{rows}</tbody>
        </table>
        <p class="note">Sample values are documentation examples, not production records.</p>
      </div>
    </details>"""


def render(models: list[dict]) -> str:
    vector_tables = sum(any(f["kind"] == "vector" for f in m["fields"]) for m in models)
    json_tables = sum(any(f["kind"] == "json" for f in m["fields"]) for m in models)
    array_tables = sum(any(f["kind"] == "array" for f in m["fields"]) for m in models)
    categories = sorted({category(m["table"]) for m in models})
    used_tables = sum(bool(m.get("usage_files")) for m in models)
    schema_only_tables = len(models) - used_tables
    cards = "\n".join(render_table(model, index) for index, model in enumerate(models, 1))
    category_options = "".join(f'<option value="{esc(value)}">{esc(value)}</option>' for value in categories)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ALOFT D360 — All Database Tables</title>
<style>
:root{{--navy:#003262;--purple:#6d28d9;--gold:#fdb515;--bg:#f8f6f1;--surface:#fff;--text:#1a2332;--muted:#5a6578;--border:#e2ddd3;--mono:Consolas,'IBM Plex Mono',monospace}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;line-height:1.55}}
.layout{{display:flex;min-height:100vh}}nav{{position:sticky;top:0;width:275px;height:100vh;overflow:auto;flex-shrink:0;padding:1rem 0;background:var(--navy);color:white}}
nav a{{display:block;padding:.45rem 1.15rem;color:#fff;text-decoration:none;font-size:.86rem;cursor:pointer}}nav a:hover{{background:#164a7a;color:var(--gold)}}nav button.group-filter{{display:block;width:100%;padding:.45rem 1.15rem;border:none;background:transparent;color:#fff;text-align:left;font:inherit;font-size:.86rem;cursor:pointer}}nav button.group-filter:hover{{background:#164a7a;color:var(--gold)}}nav .group-filter.active{{background:#164a7a;color:var(--gold);font-weight:600}}nav h2{{margin:1rem 1.15rem .35rem;color:#a9bdd2;font-size:.7rem;text-transform:uppercase;letter-spacing:.08em}}
main{{width:min(1200px,100%);padding:2rem 2.5rem 4rem}}.hero{{margin:-2rem -2.5rem 2rem;padding:2.2rem 2.5rem;background:linear-gradient(135deg,#4c1d95,var(--navy));color:#fff;border-radius:0 0 12px 12px}}.hero h1{{margin:.25rem 0 .5rem;font-size:1.8rem}}.hero p{{max-width:850px;color:#eef2ff}}.badge,.pill{{display:inline-block;border-radius:999px;padding:.12rem .45rem;font-size:.68rem;font-weight:700;margin-left:.3rem}}.badge{{color:var(--navy);background:var(--gold)}}.pill.vector{{color:#5b21b6;background:#ede9fe}}.pill.json{{color:#9a3412;background:#ffedd5}}.pill.array{{color:#166534;background:#dcfce7}}.pill.relational{{color:#1d4ed8;background:#dbeafe}}.pill.used{{color:#166534;background:#dcfce7}}.pill.schema-only{{color:#64748b;background:#e2e8f0}}.usage{{font-size:.8rem}}.used-text{{color:#166534}}.schema-text{{color:#64748b}}
h2{{color:var(--navy);border-bottom:2px solid var(--gold);padding-bottom:.3rem}}.card,.table-card{{background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:0 2px 12px #0032620d}}.card{{padding:1.15rem 1.3rem;margin:1rem 0}}.callout{{padding:1rem 1.2rem;background:#f3e8ff;color:#5b21b6;border:1px solid #c4b5fd;border-radius:12px;margin:1rem 0}}
.metrics{{display:grid;grid-template-columns:repeat(5,1fr);gap:.7rem;margin:1rem 0}}.metric{{padding:.8rem;text-align:center;background:#fff;border:1px solid var(--border);border-radius:9px}}.metric strong{{display:block;color:var(--purple);font-size:1.55rem}}.metric span{{font-size:.75rem;color:var(--muted)}}code{{font-family:var(--mono);font-size:.78rem;color:#1e40af}}
.filters{{display:flex;gap:.6rem;flex-wrap:wrap;margin:1rem 0}}input,select{{padding:.65rem .75rem;border:1px solid var(--border);border-radius:8px;background:#fff;font:inherit}}input{{min-width:280px;flex:1}}.table-card{{margin:.7rem 0;overflow:hidden}}summary{{cursor:pointer;padding:.85rem 1rem;list-style:none;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}}summary:hover{{background:#faf7ff}}summary::-webkit-details-marker{{display:none}}.number{{display:inline-flex;width:1.7rem;height:1.7rem;align-items:center;justify-content:center;border-radius:50%;background:var(--purple);color:#fff;font-size:.72rem;font-weight:700}}.table-name{{font-family:var(--mono);font-weight:700;color:var(--navy)}}.model-name{{font-size:.75rem;color:var(--muted)}}.table-body{{padding:0 1rem 1rem}}table{{width:100%;border-collapse:collapse;font-size:.8rem;margin:.6rem 0}}th,td{{padding:.42rem .55rem;border:1px solid var(--border);text-align:left;vertical-align:top}}th{{background:#f0ebe3}}.type-vector{{color:#6d28d9;font-weight:700}}.type-json{{color:#9a3412;font-weight:700}}.type-array{{color:#166534;font-weight:700}}.note{{color:var(--muted);font-size:.78rem}}.hidden{{display:none!important}}ul{{color:var(--muted)}}
@media(max-width:850px){{.layout{{display:block}}nav{{position:relative;width:100%;height:auto}}main{{padding:1rem}}.hero{{margin:-1rem -1rem 1.5rem;padding:1.6rem 1rem}}.metrics{{grid-template-columns:repeat(2,1fr)}}table{{display:block;overflow:auto;white-space:nowrap}}}}
</style>
</head>
<body>
<div class="layout">
<nav>
  <a href="self-improving-memory-guide.html">← Self-improving memory guide</a>
  <h2>Overview</h2>
  <a href="#summary">Summary</a><a href="#legend">Storage legend</a><a href="#catalog">Table catalog</a><a href="#relationships">Relationships</a>
  <h2>Groups</h2>
  {''.join(f'<button type="button" class="group-filter" data-category="{esc(value)}">{esc(value)}</button>' for value in categories)}
</nav>
<main>
<header class="hero"><span class="badge">PRISMA SCHEMA DATA DICTIONARY</span><h1>All ALOFT D360 Database Tables</h1><p>Generated from <code>prisma/schema.prisma</code>. This catalog covers every Prisma model in the project, including mapped physical table names, columns, storage kinds, vector fields, and illustrative sample values.</p></header>
<section id="summary"><h2>1. Summary</h2><div class="metrics"><div class="metric"><strong>{len(models)}</strong><span>Prisma models / tables</span></div><div class="metric"><strong>{used_tables}</strong><span>referenced in source</span></div><div class="metric"><strong>{schema_only_tables}</strong><span>no source reference found</span></div><div class="metric"><strong>{vector_tables}</strong><span>vector-enabled tables</span></div><div class="metric"><strong>{len(categories)}</strong><span>functional groups</span></div></div><div class="callout"><strong>Usage methodology:</strong> “Referenced in source” means a table name, Prisma model name, or camelCase Prisma delegate was found in <code>src/</code> or <code>scripts/</code>. It indicates code reference, not proof that the table currently has rows or live traffic. “Vector-enabled” means the Prisma field uses <code>Unsupported("vector")</code>.</div></section>
<section id="legend"><h2>2. Storage legend</h2><table><thead><tr><th>Storage kind</th><th>Meaning</th><th>Examples</th></tr></thead><tbody><tr><td>relational</td><td>Normal PostgreSQL scalar column</td><td>String, Int, Float, Boolean, DateTime</td></tr><tr><td>json</td><td>Flexible JSON/JSONB payload</td><td>event payload, configuration, metadata</td></tr><tr><td>array</td><td>PostgreSQL array</td><td>String[] for tags or source IDs</td></tr><tr><td>vector</td><td>pgvector embedding</td><td>semantic similarity retrieval</td></tr></tbody></table><p class="note">Sample values are illustrative and do not represent production data.</p></section>
<section id="relationships"><h2>3. Major relationships</h2><div class="card"><p><strong>Application:</strong> users → sessions → agent runs → tool invocations and cost logs.</p><p><strong>Context:</strong> context sources → objects → columns/profiles/semantic metadata → embeddings and mappings.</p><p><strong>Memory:</strong> trace nodes/edges → synthesis runs/details → agent memory → injections → attribution and reputation.</p><p><strong>Analytics:</strong> semantic models/measures/dimensions → dashboards/charts and audit history.</p></div></section>
<section id="catalog"><h2>4. Complete table catalog</h2><div class="filters"><input id="search" type="search" placeholder="Search table, model, category, purpose, or usage"><select id="category"><option value="">All categories</option>{category_options}</select><select id="usage"><option value="">All usage statuses</option><option value="used">Referenced in source</option><option value="schema-only">No source reference found</option></select></div><p id="result-count" class="note"></p><div id="tables">{cards}</div></section>
<section><h2>5. Source and maintenance</h2><div class="card"><p>This page is generated by <code>scripts/generate-all-tables-guide.py</code>.</p><pre>python scripts/generate-all-tables-guide.py</pre><p>Run the generator after changing <code>prisma/schema.prisma</code> so the count, table names, columns, and types stay current.</p></div></section>
</main></div>
<script>
const cards=[...document.querySelectorAll('.table-card')], search=document.getElementById('search'), category=document.getElementById('category'), usage=document.getElementById('usage'), count=document.getElementById('result-count');
function syncGroupNavActive(){{document.querySelectorAll('nav .group-filter').forEach(el=>{{el.classList.toggle('active',el.getAttribute('data-category')===category.value)}})}}
function applyCategory(cat){{category.value=cat||'';search.value='';usage.value='';filter();document.getElementById('catalog').scrollIntoView({{behavior:'smooth',block:'start'}})}}
function filter(){{const q=search.value.toLowerCase().trim(), c=category.value, u=usage.value;let shown=0;cards.forEach(card=>{{const ok=(!q||card.dataset.search.toLowerCase().includes(q))&&(!c||card.dataset.category===c)&&(!u||card.dataset.usage===u);card.classList.toggle('hidden',!ok);if(ok)shown++}});count.textContent=shown+' of '+cards.length+' tables shown';syncGroupNavActive()}}
search.addEventListener('input',filter);category.addEventListener('change',filter);usage.addEventListener('change',filter);
document.querySelector('nav').addEventListener('click',e=>{{const btn=e.target.closest('.group-filter');if(!btn)return;e.preventDefault();applyCategory(btn.getAttribute('data-category'))}});
filter();
</script>
</body>
</html>"""


def main() -> None:
    models = parse_models(SCHEMA.read_text(encoding="utf-8"))
    scan_runtime_usage(models)
    OUTPUT.write_text(render(models), encoding="utf-8")
    used = sum(bool(model.get("usage_files")) for model in models)
    print(f"Generated {OUTPUT} with {len(models)} Prisma models/tables; {used} referenced in src/scripts.")


if __name__ == "__main__":
    main()
