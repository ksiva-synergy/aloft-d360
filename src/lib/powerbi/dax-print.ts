/**
 * Print a parsed DAX AST back to DAX text (fully parenthesized binary operators, so precedence
 * never changes). Used to build decomposition probes from parts of a measure.
 */

import type { DaxNode } from '@/lib/powerbi/dax-parse';

export const daxTable = (name: string) => `'${name.replace(/'/g, "''")}'`;
export const daxColumn = (table: string | null, column: string) =>
  `${table ? daxTable(table) : ''}[${column.replace(/]/g, ']]')}]`;

export function printDax(node: DaxNode): string {
  switch (node.k) {
    case 'num':
      return node.v;
    case 'str':
      return `"${node.v.replace(/"/g, '""')}"`;
    case 'col':
      return daxColumn(node.table, node.column) + (node.level ? `.[${node.level}]` : '');
    case 'ref':
      return node.name;
    case 'tbl':
      return daxTable(node.name);
    case 'call':
      return `${node.fn}(${node.args.map(printDax).join(', ')})`;
    case 'bin':
      return `(${printDax(node.l)} ${node.op} ${printDax(node.r)})`;
    case 'un':
      return node.op === 'NOT' ? `NOT (${printDax(node.e)})` : `${node.op}(${printDax(node.e)})`;
    case 'list':
      return `{${node.items.map(printDax).join(', ')}}`;
    case 'var':
      return `${node.decls.map((d) => `VAR ${d.name} = ${printDax(d.e)}`).join('\n')}\nRETURN ${printDax(node.body)}`;
  }
}
