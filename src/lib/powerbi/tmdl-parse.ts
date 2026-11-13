/**
 * Indentation-based TMDL reader (build plan §8.6). Pure — safe for unit tests.
 */

export type TmdlBlock = {
  keyword: string;
  name?: string;
  headerLine: string;
  properties: Record<string, string>;
  bodyLines: string[];
  children: TmdlBlock[];
};

function countLeadingTabs(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === '\t') n++;
    else break;
  }
  return n;
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
  const stack: { indent: number; block: TmdlBlock }[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const indent = countLeadingTabs(line);
    const content = line.slice(indent);

    if (content.trimStart().startsWith('```')) {
      const parent = stack[stack.length - 1]?.block;
      if (parent) {
        const body: string[] = [];
        i += 1;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          body.push(lines[i]);
          i += 1;
        }
        parent.bodyLines.push(...body);
        if (i < lines.length) i += 1;
        continue;
      }
    }

    const header = parseHeader(content);
    const block: TmdlBlock = {
      keyword: header.keyword,
      name: header.name,
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
    stack.push({ indent, block });
    i += 1;
  }

  attachPropertyLines(root);
  return root;
}

function attachPropertyLines(blocks: TmdlBlock[]): void {
  for (const b of blocks) {
    const childKeywords = new Set([
      'table',
      'column',
      'measure',
      'partition',
      'relationship',
      'role',
      'model',
      'annotation',
    ]);
    const kept: TmdlBlock[] = [];
    for (const child of b.children) {
      if (childKeywords.has(child.keyword)) {
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
  }[];
  measures: {
    name: string;
    dax: string;
    lineageTag: string | null;
    formatString: string | null;
    displayFolder: string | null;
  }[];
  partitionSourceM: string;
  partitionMode: string | null;
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
  if (measure.name?.trim()) return measure.name.trim();
  const eq = measure.headerLine.indexOf('=');
  if (eq === -1) return measure.headerLine.replace(/^measure\s+/i, '').trim();
  return measure.headerLine.slice(0, eq).replace(/^measure\s+/i, '').trim();
}

export function parseTmdlTableFile(text: string): ParsedTmdlTable | null {
  const roots = parseTmdl(text);
  const table = roots.find((r) => r.keyword === 'table');
  if (!table?.name) return null;

  const columns = table.children
    .filter((c) => c.keyword === 'column')
    .map((col) => ({
      name: col.name ?? '',
      dataType: col.properties.dataType ?? null,
      sourceColumn: col.properties.sourceColumn ?? null,
      lineageTag: col.properties.lineageTag ?? null,
      formatString: col.properties.formatString ?? null,
      summarizeBy: col.properties.summarizeBy ?? null,
      calculatedDax: col.bodyLines.length ? col.bodyLines.join('\n').trim() : null,
    }));

  const measures = table.children
    .filter((c) => c.keyword === 'measure')
    .map((m) => ({
      name: measureNameFromBlock(m),
      dax: measureDax(m),
      lineageTag: m.properties.lineageTag ?? null,
      formatString: m.properties.formatString ?? null,
      displayFolder: m.properties.displayFolder ?? null,
    }));

  const { source, mode } = extractPartitionM(table, text);

  return {
    name: table.name,
    lineageTag: table.properties.lineageTag ?? null,
    hidden: table.properties.isHidden === 'true',
    columns,
    measures,
    partitionSourceM: source || blockText(table),
    partitionMode: mode,
  };
}

export type ParsedTmdlRelationship = {
  id: string;
  fromColumn: string | null;
  toColumn: string | null;
  crossFiltering: string | null;
  isActive: boolean | null;
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
    }));
}

export type ParsedTmdlRole = {
  name: string;
  filterDax: string | null;
};

export function parseTmdlRoleFile(text: string): ParsedTmdlRole | null {
  const roots = parseTmdl(text);
  const role = roots.find((r) => r.keyword === 'role');
  if (!role?.name) return null;
  const tablePerm = role.children.find((c) => c.keyword === 'tablePermission');
  const filter =
    tablePerm?.properties.filterExpression ??
    tablePerm?.bodyLines.join('\n') ??
    role.properties.filterExpression ??
    null;
  return { name: role.name.replace(/^'|'$/g, ''), filterDax: filter };
}
