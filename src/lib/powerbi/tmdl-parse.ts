/**
 * Indentation-based TMDL reader (build plan §8.6). Pure — safe for unit tests.
 */

export type TmdlBlock = {
  keyword: string;
  name?: string;
  /** `///` description lines written directly above the object. */
  description?: string;
  headerLine: string;
  properties: Record<string, string>;
  bodyLines: string[];
  children: TmdlBlock[];
};

const CHILD_BLOCK_KEYWORDS = new Set([
  'table',
  'column',
  'measure',
  'partition',
  'relationship',
  'role',
  'model',
  'annotation',
  'variation',
  'changedProperty',
  'extendedProperty',
  'hierarchy',
  'level',
  'calculationGroup',
  'calculationItem',
  'formatStringDefinition',
  'detailRowsDefinition',
  'refreshPolicy',
  'alternateOf',
  'tablePermission',
  'columnPermission',
  'member',
  'kpi',
  'relatedColumnDetails',
  'dataAccessOptions',
  'linguisticMetadata',
  'perspective',
  'perspectiveTable',
  'perspectiveColumn',
  'perspectiveMeasure',
  'perspectiveHierarchy',
  'sourceExpression',
  'pollingExpression',
  'queryGroup',
  'cultureInfo',
  'expression',
]);

/** Objects whose header may end with `=` and continue with a multi-line expression / JSON body. */
const EXPRESSION_KEYWORDS = new Set([
  'column',
  'measure',
  'tablePermission',
  'columnPermission',
  'formatStringDefinition',
  'detailRowsDefinition',
  'calculationItem',
  'expression',
  'sourceExpression',
  'pollingExpression',
  'extendedProperty',
  'linguisticMetadata',
  'annotation',
]);

/** Bare boolean flags that do not follow the `isX` pattern. */
const OTHER_BARE_FLAGS = new Set([
  'showAsVariationsOnly',
  'fastCombine',
  'legacyRedirects',
  'returnErrorValuesAsNull',
  'discourageImplicitMeasures',
  'keepUniqueRows',
  'relyOnReferentialIntegrity',
]);

const EXPRESSION_WORDS = new Set(['var', 'return', 'if', 'then', 'else', 'let', 'in', 'each', 'and', 'or', 'not', 'true', 'false', 'try', 'otherwise', 'type', 'meta']);

/** `keyword Name` / `keyword` with children, where keyword is an unknown camelCase object type. */
function isUnknownObject(b: TmdlBlock): boolean {
  if (CHILD_BLOCK_KEYWORDS.has(b.keyword) || EXPRESSION_WORDS.has(b.keyword)) return false;
  if (!/^[a-z][A-Za-z]+$/.test(b.keyword) || b.headerLine.includes(':')) return false;
  return b.children.length > 0 || Boolean(b.name && /^('(?:[^']|'')+'|\S+)(\s*=.*)?$/.test(b.headerLine.slice(b.keyword.length).trim()));
}

function isBareFlag(line: string): boolean {
  const t = line.trim();
  return BARE_FLAG_RE.test(t) || OTHER_BARE_FLAGS.has(t);
}

/** Bare boolean TMDL properties (`isHidden`, `isNameInferred`, …) carry no colon. */
const BARE_FLAG_RE = /^is[A-Z]\w*$/;

type TmdlStackFrame = {
  indent: number;
  block: TmdlBlock;
  expressionMode?: 'fenced' | 'open';
};

function isPropertyOrChildHeader(content: string): boolean {
  const trimmed = content.trim();
  const header = parseHeader(content);
  if (CHILD_BLOCK_KEYWORDS.has(header.keyword)) return true;
  if (isBareFlag(trimmed)) return true;
  if (trimmed.startsWith('///')) return true;
  return /^\w[\w.]*\s*:/.test(trimmed);
}

const TRAILING_TMDL_PROPERTY_RE = new RegExp(
  String.raw`^\s*(?:(?:${[...CHILD_BLOCK_KEYWORDS].join('|')})(?:\s|=|$)|is[A-Z]\w*\s*(?::|$)|(?:lineageTag|formatString|summarizeBy|dataType|displayFolder|sourceColumn|dataCategory|sortByColumn|description)\s*:)`,
);

/**
 * Drop TMDL property / child-object lines that a pre-fix harvest appended to a DAX
 * expression (e.g. trailing `changedProperty = DataType`). Only trailing lines are removed.
 */
export function stripTrailingTmdlProperties(dax: string | null | undefined): string | null {
  if (dax == null) return null;
  const lines = dax.replace(/\r\n/g, '\n').split('\n');
  while (lines.length > 0 && TRAILING_TMDL_PROPERTY_RE.test(lines[lines.length - 1]!)) lines.pop();
  const out = lines.join('\n').trimEnd();
  return out ? out : null;
}

function expressionModeForHeader(keyword: string, headerLine: string, rest?: string): 'fenced' | 'open' | undefined {
  if (!EXPRESSION_KEYWORDS.has(keyword)) return undefined;
  if (rest === '```') return 'fenced';
  const eq = headerLine.indexOf('=');
  if (eq === -1) return undefined;
  const afterEq = headerLine.slice(eq + 1).trim();
  if (!afterEq) return 'open';
  return undefined;
}

function countLeadingTabs(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === '\t') n++;
    else break;
  }
  return n;
}

/** Strip TMDL single-quoted identifiers (`'Key Column'` → `Key Column`). */
export function stripTmdlQuotedName(name: string | undefined): string {
  if (!name?.trim()) return name?.trim() ?? '';
  const t = name.trim();
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
  return t;
}

function parseHeader(line: string): { keyword: string; name?: string; rest?: string } {
  const trimmed = line.trim();
  const eq = trimmed.indexOf('=');
  if (eq === -1) {
    const parts = trimmed.split(/\s+/);
    return { keyword: parts[0] ?? '', name: parts.slice(1).join(' ') || undefined };
  }
  const left = trimmed.slice(0, eq).trim();
  const right = trimmed.slice(eq + 1).trim();
  const parts = left.split(/\s+/);
  const keyword = parts[0] ?? '';
  const name = parts.slice(1).join(' ') || undefined;
  return { keyword, name, rest: right || undefined };
}

/**
 * Parse a TMDL file into a tree of blocks. Handles ``` multiline measure bodies.
 */
export function parseTmdl(text: string): TmdlBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const root: TmdlBlock[] = [];
  const stack: TmdlStackFrame[] = [];
  let pendingDescription: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const indent = countLeadingTabs(line);
    const content = line.slice(indent);

    const frame = stack[stack.length - 1];
    if (frame?.expressionMode === 'fenced') {
      if (content.trimStart().startsWith('```')) {
        frame.expressionMode = undefined;
        i += 1;
        continue;
      }
      frame.block.bodyLines.push(content);
      i += 1;
      continue;
    }

    if (content.trimStart().startsWith('```')) {
      if (frame?.expressionMode === 'open') {
        frame.expressionMode = 'fenced';
        i += 1;
        continue;
      }
      const parent = frame?.block;
      if (parent) {
        const body: string[] = [];
        i += 1;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          body.push(lines[i].slice(countLeadingTabs(lines[i])));
          i += 1;
        }
        parent.bodyLines.push(...body);
        if (i < lines.length) i += 1;
        continue;
      }
    }

    if (frame?.expressionMode === 'open') {
      const propIndent = frame.indent + 1;
      if (indent > frame.indent) {
        if (indent === propIndent && isPropertyOrChildHeader(content)) {
          frame.expressionMode = undefined;
        } else {
          frame.block.bodyLines.push(content);
          i += 1;
          continue;
        }
      } else {
        frame.expressionMode = undefined;
      }
    }

    // `///` lines describe the next object
    if (content.trimStart().startsWith('///')) {
      if (frame?.expressionMode === 'open') frame.expressionMode = undefined;
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
      pendingDescription.push(content.trimStart().replace(/^\/\/\/\s?/, ''));
      i += 1;
      continue;
    }

    const header = parseHeader(content);
    const description = pendingDescription.length ? pendingDescription.join('\n').trim() : undefined;
    pendingDescription = [];
    const block: TmdlBlock = {
      keyword: header.keyword,
      name: header.name,
      ...(description ? { description } : {}),
      headerLine: content.trim(),
      properties: {},
      bodyLines: header.rest && header.rest !== '```' ? [header.rest] : [],
      children: [],
    };

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(block);
    } else {
      stack[stack.length - 1].block.children.push(block);
    }
    const parentBlock = stack.length > 0 ? stack[stack.length - 1].block : null;
    const expressionMode =
      isCalculatedPartitionSource(block, parentBlock)
        ? header.rest === '```'
          ? 'fenced'
          : header.rest
            ? undefined
            : 'open'
        : expressionModeForHeader(block.keyword, block.headerLine, header.rest);
    stack.push({ indent, block, expressionMode });
    i += 1;
  }

  attachPropertyLines(root);
  return root;
}

/** `source = …` directly under `partition X = calculated` holds a DAX table expression. */
/** `source = …` directly under a partition (M, calculated, …) holds the partition expression. */
function isCalculatedPartitionSource(block: TmdlBlock, parent: TmdlBlock | null): boolean {
  return block.keyword === 'source' && parent?.keyword === 'partition';
}

function attachPropertyLines(blocks: TmdlBlock[]): void {
  for (const b of blocks) {
    const childKeywords = CHILD_BLOCK_KEYWORDS;
    const kept: TmdlBlock[] = [];
    for (const child of b.children) {
      if (isCalculatedPartitionSource(child, b)) {
        kept.push(child);
      } else if (!child.children.length && !child.bodyLines.length && isBareFlag(child.headerLine)) {
        // `isHidden`, `isNameInferred`, `fastCombine` …: a boolean property, never DAX text
        b.properties[child.headerLine.trim()] = 'true';
      } else if (isUnknownObject(child)) {
        // a TMDL object type this reader does not know (e.g. a newer feature): keep it as an
        // object so it is reported and never leaks into the parent's DAX / M text
        kept.push(child);
      } else if (childKeywords.has(child.keyword)) {
        kept.push(child);
        attachPropertyLines([child]);
      } else if (child.headerLine.includes(':') && !child.keyword.includes(' ')) {
        const colonIdx = child.headerLine.indexOf(':');
        const key = child.headerLine.slice(0, colonIdx).trim().replace(/:$/, '');
        b.properties[key] = child.headerLine.slice(colonIdx + 1).trim();
      } else {
        b.bodyLines.push(child.headerLine);
      }
    }
    b.children = kept;
    for (const child of b.children) attachPropertyLines([child]);
  }
}

export type ParsedTmdlTable = {
  name: string;
  lineageTag: string | null;
  hidden: boolean;
  columns: {
    name: string;
    dataType: string | null;
    sourceColumn: string | null;
    lineageTag: string | null;
    formatString: string | null;
    summarizeBy: string | null;
    calculatedDax: string | null;
    displayFolder: string | null;
    meta: TmdlColumnMeta;
  }[];
  measures: {
    name: string;
    dax: string;
    lineageTag: string | null;
    formatString: string | null;
    displayFolder: string | null;
    meta: TmdlMeasureMeta;
  }[];
  meta: TmdlTableMeta;
  partitionSourceM: string;
  partitionMode: string | null;
  /** Partition type from its TMDL header (`partition X = calculated | m | entity …`). */
  partitionType: string | null;
};

function blockText(block: TmdlBlock): string {
  const parts = [block.headerLine, ...block.bodyLines];
  for (const c of block.children) {
    if (c.keyword === 'annotation') continue;
    parts.push(...collectBlockLines(c));
  }
  return parts.join('\n');
}

function collectBlockLines(block: TmdlBlock): string[] {
  const out = [block.headerLine, ...block.bodyLines];
  for (const c of block.children) out.push(...collectBlockLines(c));
  return out;
}

function fallbackPartitionSourceFromText(text: string): { source: string; mode: string | null } {
  const modeMatch = text.match(/\bmode:\s*(\w+)/i);
  const mode = modeMatch?.[1] ?? null;
  const src = text.match(/\bsource\s*=\s*\n([\s\S]*?)(?=\n\tannotation\b|\n\tref\b|\s*$)/i);
  return { source: src?.[1]?.trim() ?? '', mode };
}

function extractPartitionM(table: TmdlBlock, fileText: string): { source: string; mode: string | null } {
  const partition = table.children.find((c) => c.keyword === 'partition');
  if (!partition) return fallbackPartitionSourceFromText(fileText);
  const mode = partition.properties.mode ?? null;
  const fromProp = partition.properties.source;
  if (fromProp) return { source: fromProp, mode };
  const sourceChild = partition.children.find((c) => c.headerLine.startsWith('source'));
  const lines = sourceChild
    ? [...sourceChild.bodyLines, ...sourceChild.children.flatMap(collectBlockLines)]
    : [...partition.bodyLines, ...partition.children.flatMap(collectBlockLines)];
  const fromTree = lines.join('\n').trim();
  if (sourceChild && isCalculatedPartitionSource(sourceChild, partition) && fromTree) {
    return { source: fromTree, mode };
  }
  if (fromTree.includes('NativeQuery') || fromTree.includes('FromRows')) {
    return { source: fromTree, mode };
  }
  const fallback = fallbackPartitionSourceFromText(fileText);
  return { source: fallback.source || fromTree, mode: mode ?? fallback.mode };
}

function measureDax(measure: TmdlBlock): string {
  if (measure.bodyLines.length > 0) return measure.bodyLines.join('\n').trim();
  const eq = measure.headerLine.indexOf('=');
  if (eq === -1) return '';
  const rest = measure.headerLine.slice(eq + 1).trim();
  if (rest && rest !== '```') return rest;
  return '';
}

function measureNameFromBlock(measure: TmdlBlock): string {
  // TMDL quotes names with spaces/special characters ('Avg CO2'); DAX refers to [Avg CO2].
  if (measure.name?.trim()) return stripTmdlQuotedName(measure.name);
  const eq = measure.headerLine.indexOf('=');
  if (eq === -1) return stripTmdlQuotedName(measure.headerLine.replace(/^measure\s+/i, ''));
  return stripTmdlQuotedName(measure.headerLine.slice(0, eq).replace(/^measure\s+/i, ''));
}

export function parseTmdlTableFile(text: string): ParsedTmdlTable | null {
  const roots = parseTmdl(text);
  const table = roots.find((r) => r.keyword === 'table');
  if (!table?.name) return null;

  const columns = table.children
    .filter((c) => c.keyword === 'column')
    .map((col) => ({
      name: stripTmdlQuotedName(col.name ?? col.headerLine.replace(/^column\s+/i, '').split('=')[0]),
      dataType: col.properties.dataType ?? null,
      sourceColumn: col.properties.sourceColumn ?? null,
      lineageTag: col.properties.lineageTag ?? null,
      formatString: col.properties.formatString ?? null,
      summarizeBy: col.properties.summarizeBy ?? null,
      calculatedDax: col.bodyLines.length ? col.bodyLines.join('\n').trim() : null,
      displayFolder: col.properties.displayFolder ?? null,
      meta: columnMeta(col),
    }));

  const measures = table.children
    .filter((c) => c.keyword === 'measure')
    .map((m) => ({
      name: measureNameFromBlock(m),
      dax: measureDax(m),
      lineageTag: m.properties.lineageTag ?? null,
      formatString: m.properties.formatString ?? null,
      displayFolder: m.properties.displayFolder ?? null,
      meta: measureMeta(m),
    }));

  const { source, mode } = extractPartitionM(table, text);
  const partitionBlock = table.children.find((c) => c.keyword === 'partition');
  const partitionType =
    partitionBlock?.headerLine.match(/=\s*([A-Za-z]+)\s*$/)?.[1]?.toLowerCase() ?? null;

  return {
    name: stripTmdlQuotedName(table.name),
    lineageTag: table.properties.lineageTag ?? null,
    hidden: table.properties.isHidden === 'true',
    columns,
    measures,
    meta: tableMeta(table),
    // No partition (measure-only table) → no source. Never store the table's TMDL text here:
    // downstream it would be read as a DAX calculated-table expression.
    partitionSourceM: source,
    partitionMode: mode,
    partitionType,
  };
}

export type ParsedTmdlRelationship = {
  id: string;
  fromColumn: string | null;
  toColumn: string | null;
  crossFiltering: string | null;
  isActive: boolean | null;
  /** `many_to_one` (TMDL default), `one_to_one`, `many_to_many`, `one_to_many`. */
  cardinality: string;
  meta: TmdlObjectMeta;
};

export function parseTmdlRelationshipsFile(text: string): ParsedTmdlRelationship[] {
  const roots = parseTmdl(text);
  return roots
    .filter((r) => r.keyword === 'relationship')
    .map((rel) => ({
      id: rel.name ?? rel.properties.lineageTag ?? rel.headerLine,
      fromColumn: rel.properties.fromColumn ?? null,
      toColumn: rel.properties.toColumn ?? null,
      crossFiltering: rel.properties.crossFilteringBehavior ?? null,
      isActive: rel.properties.isActive ? rel.properties.isActive === 'true' : null,
      cardinality: `${rel.properties.fromCardinality ?? 'many'}_to_${rel.properties.toCardinality ?? 'one'}`,
      meta: objectMeta(rel, ['fromColumn', 'toColumn', 'crossFilteringBehavior', 'isActive', 'lineageTag']),
    }));
}

export type ParsedTmdlRole = {
  name: string;
  /** All table filters, one per line as `Table: <DAX>` (kept for older readers). */
  filterDax: string | null;
  modelPermission: string | null;
  tablePermissions: { table: string; filter: string | null }[];
  columnPermissions: { table: string; column: string; permission: string | null }[];
  members: { name: string; identityProvider: string | null; memberType: string | null }[];
  meta: TmdlObjectMeta;
};

/** The expression of `keyword Name = <expr>` (header remainder plus any multi-line body). */
function expressionText(block: TmdlBlock): string | null {
  const eq = block.headerLine.indexOf('=');
  const rest = eq === -1 ? '' : block.headerLine.slice(eq + 1).trim();
  const body = block.bodyLines[0] === rest ? block.bodyLines.slice(1) : block.bodyLines;
  const lines = [...(rest && rest !== '```' ? [rest] : []), ...body];
  const text = lines.join('\n').trim();
  return text || null;
}

export function parseTmdlRoleFile(text: string): ParsedTmdlRole | null {
  const roots = parseTmdl(text);
  const role = roots.find((r) => r.keyword === 'role');
  if (!role?.name) return null;
  const perms = role.children.filter((c) => c.keyword === 'tablePermission');
  const tablePermissions = perms.map((c) => ({
    table: stripTmdlQuotedName(c.name ?? ''),
    filter: c.properties.filterExpression ?? expressionText(c),
  }));
  const columnPermissions = perms.flatMap((t) =>
    t.children
      .filter((c) => c.keyword === 'columnPermission')
      .map((c) => ({
        table: stripTmdlQuotedName(t.name ?? ''),
        column: stripTmdlQuotedName(c.name ?? ''),
        permission: c.properties.metadataPermission ?? expressionText(c),
      })),
  );
  const members = role.children
    .filter((c) => c.keyword === 'member')
    .map((c) => ({
      name: stripTmdlQuotedName(c.name ?? ''),
      identityProvider: c.properties.identityProvider ?? null,
      memberType: c.properties.memberType ?? null,
    }));
  const withFilter = tablePermissions.filter((t) => t.filter);
  const filterDax = withFilter.length
    ? withFilter.map((t) => `${t.table}: ${t.filter}`).join('\n')
    : (role.properties.filterExpression ?? null);
  return {
    name: stripTmdlQuotedName(role.name),
    filterDax,
    modelPermission: role.properties.modelPermission ?? null,
    tablePermissions,
    columnPermissions,
    members,
    meta: objectMeta(role, ['modelPermission']),
  };
}

// ── Metadata beyond what recreation needs today (kept so nothing in the definition is lost) ──

export type TmdlObjectMeta = {
  description?: string;
  /** Every scalar property (bare flags as 'true'), except the ones stored in their own column. */
  properties?: Record<string, string>;
  annotations?: Record<string, string>;
  extendedProperties?: Record<string, string>;
};

export type TmdlColumnMeta = TmdlObjectMeta & {
  hidden?: boolean;
  /** Auto date/time variations: the relationship to the LocalDateTable and its default hierarchy. */
  variations?: { name: string; relationship: string | null; defaultHierarchy: string | null; isDefault: boolean }[];
  /** Field-parameter / group columns: the columns this one is grouped by. */
  groupByColumns?: string[];
  alternateOf?: Record<string, string>;
};

export type TmdlMeasureMeta = TmdlObjectMeta & {
  hidden?: boolean;
  /** Dynamic format string (DAX). */
  formatStringDefinition?: string;
  detailRowsDefinition?: string;
  kpi?: Record<string, string>;
};

export type TmdlRefreshPolicy = {
  policyType: string | null;
  mode: string | null;
  rollingWindowGranularity: string | null;
  rollingWindowPeriods: number | null;
  incrementalGranularity: string | null;
  incrementalPeriods: number | null;
  incrementalPeriodsOffset: number | null;
  pollingExpression: string | null;
  sourceExpression: string | null;
};

export type TmdlTableMeta = TmdlObjectMeta & {
  hidden?: boolean;
  /** Every partition (name, type, mode, source). Recreation reads the first one's source. */
  partitions?: { name: string; type: string | null; mode: string | null; source: string | null; queryGroup: string | null }[];
  refreshPolicy?: TmdlRefreshPolicy;
  hierarchies?: { name: string; description?: string; hidden: boolean; levels: { name: string; column: string | null }[] }[];
  calculationGroup?: {
    precedence: number | null;
    items: { name: string; ordinal: number | null; expression: string | null; formatStringDefinition: string | null }[];
  };
  /** Field parameter table (NAMEOF list with a grouped "Fields" column): a slicer helper. */
  fieldParameter?: boolean;
};

const STORED_COLUMN_PROPS = ['dataType', 'sourceColumn', 'lineageTag', 'formatString', 'summarizeBy', 'displayFolder'];
const STORED_MEASURE_PROPS = ['lineageTag', 'formatString', 'displayFolder'];

function annotationsOf(block: TmdlBlock, keyword: 'annotation' | 'extendedProperty'): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const c of block.children) {
    if (c.keyword !== keyword || !c.name) continue;
    const v = expressionText(c);
    if (v != null) out[stripTmdlQuotedName(c.name)] = v.slice(0, 4000);
  }
  return Object.keys(out).length ? out : undefined;
}

function objectMeta(block: TmdlBlock, stored: string[] = []): TmdlObjectMeta {
  const props: Record<string, string> = {};
  for (const [k, v] of Object.entries(block.properties)) if (!stored.includes(k)) props[k] = v;
  const meta: TmdlObjectMeta = {};
  if (block.description) meta.description = block.description;
  if (Object.keys(props).length) meta.properties = props;
  const ann = annotationsOf(block, 'annotation');
  if (ann) meta.annotations = ann;
  const ext = annotationsOf(block, 'extendedProperty');
  if (ext) meta.extendedProperties = ext;
  return meta;
}

function columnMeta(col: TmdlBlock): TmdlColumnMeta {
  const meta: TmdlColumnMeta = objectMeta(col, STORED_COLUMN_PROPS);
  if (col.properties.isHidden === 'true') meta.hidden = true;
  const variations = col.children
    .filter((c) => c.keyword === 'variation')
    .map((v) => ({
      name: stripTmdlQuotedName(v.name ?? ''),
      relationship: v.properties.relationship ?? null,
      defaultHierarchy: v.properties.defaultHierarchy ?? null,
      isDefault: v.properties.isDefault === 'true',
    }));
  if (variations.length) meta.variations = variations;
  const groupBy = col.children
    .filter((c) => c.keyword === 'relatedColumnDetails')
    .flatMap((c) => [c.properties.groupByColumn, ...c.children.filter((g) => g.keyword === 'groupByColumn').map((g) => g.name)])
    .filter((x): x is string => Boolean(x))
    .map(stripTmdlQuotedName);
  if (groupBy.length) meta.groupByColumns = [...new Set(groupBy)];
  const alt = col.children.find((c) => c.keyword === 'alternateOf');
  if (alt) meta.alternateOf = { ...alt.properties };
  return meta;
}

function measureMeta(m: TmdlBlock): TmdlMeasureMeta {
  const meta: TmdlMeasureMeta = objectMeta(m, STORED_MEASURE_PROPS);
  if (m.properties.isHidden === 'true') meta.hidden = true;
  const fsd = m.children.find((c) => c.keyword === 'formatStringDefinition');
  const fsdText = fsd ? expressionText(fsd) : null;
  if (fsdText) meta.formatStringDefinition = fsdText;
  const drd = m.children.find((c) => c.keyword === 'detailRowsDefinition');
  const drdText = drd ? expressionText(drd) : null;
  if (drdText) meta.detailRowsDefinition = drdText;
  const kpi = m.children.find((c) => c.keyword === 'kpi');
  if (kpi) {
    const k: Record<string, string> = { ...kpi.properties };
    for (const c of kpi.children) {
      const t = expressionText(c);
      if (t) k[c.keyword] = t;
    }
    meta.kpi = k;
  }
  return meta;
}

const num = (v: string | undefined) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

function partitionSourceText(p: TmdlBlock): string {
  if (p.properties.source) return p.properties.source;
  const src = p.children.find((c) => c.keyword === 'source');
  return src ? [...src.bodyLines, ...src.children.flatMap(collectBlockLines)].join('\n').trim() : '';
}

function tableMeta(table: TmdlBlock): TmdlTableMeta {
  const meta: TmdlTableMeta = objectMeta(table, ['lineageTag']);
  if (table.properties.isHidden === 'true') meta.hidden = true;
  const partitions = table.children
    .filter((c) => c.keyword === 'partition')
    .map((p) => {
      const srcText = partitionSourceText(p);
      return {
        name: stripTmdlQuotedName(p.name ?? ''),
        type: p.headerLine.match(/=\s*([A-Za-z]+)\s*$/)?.[1]?.toLowerCase() ?? null,
        mode: p.properties.mode ?? null,
        source: srcText ? srcText.slice(0, 20_000) : null,
        queryGroup: p.properties.queryGroup ?? null,
      };
    });
  if (partitions.length) meta.partitions = partitions;
  const rp = table.children.find((c) => c.keyword === 'refreshPolicy');
  if (rp) {
    const child = (k: string) => {
      const c = rp.children.find((x) => x.keyword === k);
      return c ? expressionText(c) : (rp.properties[k] ?? null);
    };
    meta.refreshPolicy = {
      policyType: rp.properties.policyType ?? null,
      mode: rp.properties.mode ?? null,
      rollingWindowGranularity: rp.properties.rollingWindowGranularity ?? null,
      rollingWindowPeriods: num(rp.properties.rollingWindowPeriods),
      incrementalGranularity: rp.properties.incrementalGranularity ?? null,
      incrementalPeriods: num(rp.properties.incrementalPeriods),
      incrementalPeriodsOffset: num(rp.properties.incrementalPeriodsOffset),
      pollingExpression: child('pollingExpression'),
      sourceExpression: child('sourceExpression'),
    };
  }
  const hierarchies = table.children
    .filter((c) => c.keyword === 'hierarchy')
    .map((h) => ({
      name: stripTmdlQuotedName(h.name ?? ''),
      ...(h.description ? { description: h.description } : {}),
      hidden: h.properties.isHidden === 'true',
      levels: h.children
        .filter((l) => l.keyword === 'level')
        .map((l) => ({ name: stripTmdlQuotedName(l.name ?? ''), column: l.properties.column ? stripTmdlQuotedName(l.properties.column) : null })),
    }));
  if (hierarchies.length) meta.hierarchies = hierarchies;
  const cg = table.children.find((c) => c.keyword === 'calculationGroup');
  if (cg) {
    meta.calculationGroup = {
      precedence: num(cg.properties.precedence),
      items: cg.children
        .filter((c) => c.keyword === 'calculationItem')
        .map((it) => {
          const f = it.children.find((c) => c.keyword === 'formatStringDefinition');
          return {
            name: stripTmdlQuotedName(it.name ?? ''),
            ordinal: num(it.properties.ordinal),
            expression: expressionText(it),
            formatStringDefinition: f ? expressionText(f) : null,
          };
        }),
    };
  }
  const columns = table.children.filter((c) => c.keyword === 'column');
  if (
    columns.some((c) => c.children.some((x) => x.keyword === 'relatedColumnDetails')) &&
    /\bNAMEOF\s*\(/i.test(partitions[0]?.source ?? '')
  ) {
    meta.fieldParameter = true;
  }
  return meta;
}

// ── Model-level files ─────────────────────────────────────────────────────────────────────────

export type ParsedTmdlModel = {
  culture: string | null;
  /** Culture Power Query uses to convert text to dates / numbers (e.g. en-IN reads dd/MM). */
  sourceQueryCulture: string | null;
  discourageImplicitMeasures: boolean;
  defaultPowerBIDataSourceVersion: string | null;
  dataAccessOptions: string[];
  /** Auto date/time enabled for new date columns. */
  timeIntelligenceEnabled: boolean | null;
  queryGroups: { name: string; description?: string; folder: string | null }[];
  perspectives: string[];
  meta: TmdlObjectMeta;
};

export function parseTmdlModelFile(text: string): ParsedTmdlModel | null {
  const roots = parseTmdl(text);
  const model = roots.find((r) => r.keyword === 'model');
  if (!model) return null;
  const all = [...roots, ...model.children];
  const annotations: Record<string, string> = {};
  for (const r of all) {
    if (r.keyword === 'annotation' && r.name) annotations[stripTmdlQuotedName(r.name)] = (expressionText(r) ?? '').slice(0, 4000);
  }
  const dao = model.children.find((c) => c.keyword === 'dataAccessOptions');
  const meta = objectMeta(model, ['culture', 'sourceQueryCulture', 'discourageImplicitMeasures', 'defaultPowerBIDataSourceVersion']);
  if (Object.keys(annotations).length) meta.annotations = annotations;
  const tie = annotations.__PBI_TimeIntelligenceEnabled;
  return {
    culture: model.properties.culture ?? null,
    sourceQueryCulture: model.properties.sourceQueryCulture ?? null,
    discourageImplicitMeasures: model.properties.discourageImplicitMeasures === 'true',
    defaultPowerBIDataSourceVersion: model.properties.defaultPowerBIDataSourceVersion ?? null,
    dataAccessOptions: dao ? Object.keys(dao.properties).filter((k) => dao.properties[k] === 'true') : [],
    timeIntelligenceEnabled: tie == null ? null : tie.trim() === '1',
    queryGroups: all
      .filter((c) => c.keyword === 'queryGroup')
      .map((q) => ({
        name: stripTmdlQuotedName(q.name ?? ''),
        ...(q.description ? { description: q.description } : {}),
        folder: q.properties.folder ?? null,
      })),
    perspectives: all.filter((c) => c.keyword === 'perspective').map((p) => stripTmdlQuotedName(p.name ?? '')),
    meta,
  };
}

export function parseTmdlDatabaseFile(text: string): { compatibilityLevel: number | null; compatibilityMode: string | null } {
  const db = parseTmdl(text).find((r) => r.keyword === 'database');
  return {
    compatibilityLevel: num(db?.properties.compatibilityLevel),
    compatibilityMode: db?.properties.compatibilityMode ?? null,
  };
}

type LinguisticEntity = {
  Definition?: { Binding?: Record<string, string> };
  Terms?: Record<string, { State?: string; Weight?: number }>[];
};

/**
 * Q&A linguistic schema (cultures/*.tmdl) → synonyms per model object. Keeps authored terms and
 * high-weight generated ones; drops thesaurus suggestions and deleted terms. Key is the
 * conceptual binding: `Table`, `Table.Column` or `Table.Measure`.
 */
export function parseTmdlCultureFile(
  text: string,
  opts: { maxEntities?: number; maxTermsPerEntity?: number } = {},
): { culture: string | null; synonyms: Record<string, string[]>; authored: number } {
  const culture = text.match(/^cultureInfo\s+(\S+)/m)?.[1] ?? null;
  const at = text.indexOf('linguisticMetadata');
  const start = at === -1 ? -1 : text.indexOf('{', at);
  const synonyms: Record<string, string[]> = {};
  let authored = 0;
  if (start === -1) return { culture, synonyms, authored };
  let json: { Entities?: Record<string, LinguisticEntity> };
  try {
    const body = text.slice(start);
    json = JSON.parse(body.slice(0, matchingBrace(body) + 1));
  } catch {
    return { culture, synonyms, authored };
  }
  const maxEntities = opts.maxEntities ?? 5000;
  const maxTerms = opts.maxTermsPerEntity ?? 10;
  for (const ent of Object.values(json.Entities ?? {})) {
    if (Object.keys(synonyms).length >= maxEntities) break;
    const b = ent.Definition?.Binding ?? {};
    const key = [b.ConceptualEntity, b.ConceptualProperty].filter(Boolean).join('.');
    if (!key) continue;
    const terms: string[] = [];
    for (const t of ent.Terms ?? []) {
      for (const [term, info] of Object.entries(t)) {
        const state = info?.State ?? 'Authored';
        if (state === 'Suggested' || state === 'Deleted') continue;
        if (state === 'Generated' && (info?.Weight ?? 1) < 0.9) continue;
        if (state === 'Authored') authored += 1;
        if (!terms.includes(term)) terms.push(term);
      }
    }
    if (terms.length) synonyms[key] = [...new Set([...(synonyms[key] ?? []), ...terms])].slice(0, maxTerms);
  }
  return { culture, synonyms, authored };
}

function matchingBrace(s: string): number {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return s.length - 1;
}

// ── Coverage guard: TMDL object types this parser does not interpret ──────────────────────────

const KNOWN_OBJECT_KEYWORDS = new Set([...CHILD_BLOCK_KEYWORDS, 'source', 'ref', 'database', 'groupByColumn']);

/**
 * Object keywords in a TMDL file that the parser does not interpret (their scalar properties are
 * still kept generically). Recorded per model at parse time so new TMDL features surface instead
 * of being silently dropped.
 */
export function unhandledTmdlKeywords(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (blocks: TmdlBlock[]) => {
    for (const b of blocks) {
      if (!KNOWN_OBJECT_KEYWORDS.has(b.keyword) && !isBareFlag(b.keyword) && /^[a-z][A-Za-z]+$/.test(b.keyword) && !b.headerLine.includes(':')) {
        out[b.keyword] = (out[b.keyword] ?? 0) + 1;
      }
      walk(b.children);
    }
  };
  walk(parseTmdl(text));
  return out;
}
