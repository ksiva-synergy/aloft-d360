/**
 * DAX expression parser → AST. Covers the expression language (VAR/RETURN, operators,
 * function calls, column/measure/table refs, list literals). No model knowledge.
 */

export type DaxNode =
  | { k: 'num'; v: string }
  | { k: 'str'; v: string }
  /** 'T'[c], T[c], or [c] (table = null: column of the row context, or a measure). */
  | { k: 'col'; table: string | null; column: string }
  /** Bare identifier: variable name or unquoted table name. */
  | { k: 'ref'; name: string }
  /** Quoted table reference without a column: 'T'. */
  | { k: 'tbl'; name: string }
  | { k: 'call'; fn: string; args: DaxNode[] }
  | { k: 'bin'; op: string; l: DaxNode; r: DaxNode }
  | { k: 'un'; op: '-' | '+' | 'NOT'; e: DaxNode }
  | { k: 'var'; decls: { name: string; e: DaxNode }[]; body: DaxNode }
  | { k: 'list'; items: DaxNode[] };

type Tok =
  | { t: 'num'; v: string }
  | { t: 'str'; v: string }
  | { t: 'qtbl'; v: string }
  | { t: 'br'; v: string; adj: boolean }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'eof' };

export class DaxParseError extends Error {}

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let prevEnd = -1;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if ((c === '/' && src[i + 1] === '/') || (c === '-' && src[i + 1] === '-')) {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    const start = i;
    if (c === '"') {
      let v = '';
      i += 1;
      while (i < src.length) {
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            v += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        v += src[i];
        i += 1;
      }
      out.push({ t: 'str', v });
    } else if (c === "'") {
      let v = '';
      i += 1;
      while (i < src.length) {
        if (src[i] === "'") {
          if (src[i + 1] === "'") {
            v += "'";
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        v += src[i];
        i += 1;
      }
      out.push({ t: 'qtbl', v });
    } else if (c === '[') {
      let v = '';
      i += 1;
      while (i < src.length) {
        if (src[i] === ']') {
          if (src[i + 1] === ']') {
            v += ']';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        v += src[i];
        i += 1;
      }
      out.push({ t: 'br', v: v.trim(), adj: prevEnd === start });
    } else {
      const num = src.slice(i).match(/^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/);
      const id = src.slice(i).match(/^[A-Za-z_][\w.]*/);
      const op = src.slice(i).match(/^(&&|\|\||<>|<=|>=|==|[=<>+\-*/&^(),{}])/);
      if (num) {
        out.push({ t: 'num', v: num[0] });
        i += num[0].length;
      } else if (id) {
        out.push({ t: 'id', v: id[0] });
        i += id[0].length;
      } else if (op) {
        out.push({ t: 'op', v: op[0] });
        i += op[0].length;
      } else {
        throw new DaxParseError(`Unexpected character '${c}' at ${i}`);
      }
    }
    prevEnd = i;
  }
  out.push({ t: 'eof' });
  return out;
}

const BIN_BP: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '=': 4,
  '==': 4,
  '<>': 4,
  '<': 4,
  '>': 4,
  '<=': 4,
  '>=': 4,
  IN: 4,
  '&': 5,
  '+': 6,
  '-': 6,
  '*': 7,
  '/': 7,
  '^': 8,
};

class Parser {
  private pos = 0;
  constructor(private readonly toks: Tok[]) {}

  parseAll(): DaxNode {
    const e = this.expr(0);
    if (this.peek().t !== 'eof') throw new DaxParseError('Unexpected trailing tokens');
    return e;
  }

  private peek(o = 0): Tok {
    return this.toks[Math.min(this.pos + o, this.toks.length - 1)]!;
  }
  private next(): Tok {
    return this.toks[this.pos++]!;
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.t === 'op' && t.v === v;
  }
  private isKw(v: string): boolean {
    const t = this.peek();
    return t.t === 'id' && t.v.toUpperCase() === v;
  }
  private expectOp(v: string) {
    const t = this.next();
    if (t.t !== 'op' || t.v !== v) throw new DaxParseError(`Expected '${v}'`);
  }

  private binOp(): string | null {
    const t = this.peek();
    if (t.t === 'op' && BIN_BP[t.v] !== undefined) return t.v;
    if (t.t === 'id' && t.v.toUpperCase() === 'IN') return 'IN';
    return null;
  }

  expr(minBp: number): DaxNode {
    let left = this.prefix();
    for (;;) {
      const op = this.binOp();
      if (!op) break;
      const bp = BIN_BP[op]!;
      if (bp <= minBp) break;
      this.next();
      const right = this.expr(op === '^' ? bp - 1 : bp);
      left = { k: 'bin', op: op === '==' ? '==' : op, l: left, r: right };
    }
    return left;
  }

  private prefix(): DaxNode {
    if (this.isOp('-') || this.isOp('+')) {
      const op = this.next() as { v: '-' | '+' };
      return { k: 'un', op: op.v, e: this.expr(8) };
    }
    if (this.isKw('NOT') && !(this.peek(1).t === 'op' && (this.peek(1) as { v: string }).v === '(')) {
      this.next();
      return { k: 'un', op: 'NOT', e: this.expr(3) };
    }
    return this.primary();
  }

  private primary(): DaxNode {
    const t = this.next();
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'br') return { k: 'col', table: null, column: t.v };
    if (t.t === 'qtbl') {
      const n = this.peek();
      if (n.t === 'br') {
        this.next();
        return { k: 'col', table: t.v, column: n.v };
      }
      return { k: 'tbl', name: t.v };
    }
    if (t.t === 'op' && t.v === '(') {
      const e = this.expr(0);
      this.expectOp(')');
      return e;
    }
    if (t.t === 'op' && t.v === '{') {
      const items: DaxNode[] = [];
      while (!this.isOp('}')) {
        items.push(this.expr(0));
        if (this.isOp(',')) this.next();
        else if (!this.isOp('}')) throw new DaxParseError('Expected , or } in list');
      }
      this.next();
      return { k: 'list', items };
    }
    if (t.t === 'id') {
      const upper = t.v.toUpperCase();
      if (upper === 'VAR') return this.varBlock();
      const n = this.peek();
      if (n.t === 'op' && n.v === '(') {
        this.next();
        const args: DaxNode[] = [];
        while (!this.isOp(')')) {
          if (this.isOp(',')) {
            // omitted optional argument
            args.push({ k: 'ref', name: '' });
            this.next();
            continue;
          }
          args.push(this.expr(0));
          if (this.isOp(',')) {
            this.next();
            if (this.isOp(')')) args.push({ k: 'ref', name: '' });
          } else if (!this.isOp(')')) throw new DaxParseError(`Expected , or ) in ${t.v}(…)`);
        }
        this.next();
        if (upper === 'NOT' && args.length === 1) return { k: 'un', op: 'NOT', e: args[0]! };
        return { k: 'call', fn: upper, args };
      }
      if (n.t === 'br' && n.adj) {
        this.next();
        return { k: 'col', table: t.v, column: n.v };
      }
      if (upper === 'TRUE' || upper === 'FALSE') return { k: 'call', fn: upper, args: [] };
      return { k: 'ref', name: t.v };
    }
    throw new DaxParseError('Unexpected token');
  }

  private varBlock(): DaxNode {
    const decls: { name: string; e: DaxNode }[] = [];
    for (;;) {
      const name = this.next();
      if (name.t !== 'id') throw new DaxParseError('Expected variable name after VAR');
      this.expectOp('=');
      decls.push({ name: name.v, e: this.expr(0) });
      if (this.isKw('VAR')) {
        this.next();
        continue;
      }
      if (this.isKw('RETURN')) {
        this.next();
        break;
      }
      throw new DaxParseError('Expected VAR or RETURN');
    }
    return { k: 'var', decls, body: this.expr(0) };
  }
}

export function parseDax(src: string): DaxNode {
  return new Parser(lex(src)).parseAll();
}

/** Column refs in an AST (excluding variable refs). */
export function collectColumnRefs(node: DaxNode, out: { table: string | null; column: string }[] = []) {
  switch (node.k) {
    case 'col':
      out.push({ table: node.table, column: node.column });
      break;
    case 'call':
      node.args.forEach((a) => collectColumnRefs(a, out));
      break;
    case 'bin':
      collectColumnRefs(node.l, out);
      collectColumnRefs(node.r, out);
      break;
    case 'un':
      collectColumnRefs(node.e, out);
      break;
    case 'var':
      node.decls.forEach((d) => collectColumnRefs(d.e, out));
      collectColumnRefs(node.body, out);
      break;
    case 'list':
      node.items.forEach((a) => collectColumnRefs(a, out));
      break;
    default:
      break;
  }
  return out;
}
