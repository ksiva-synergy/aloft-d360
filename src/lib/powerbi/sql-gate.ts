/**
 * Statement gate for every SQL the Power BI bridge executes on Databricks (compiler output,
 * LLM-written SQL, registry rules, native SQL copied from Power Query, investigation probes).
 *
 * Allowed: exactly one read-only query — SELECT / WITH … SELECT / VALUES (EXPLAIN is added by
 * the executor). Blocked: anything that writes, changes configuration, reads files or calls out
 * (DML/DDL, SET, COPY INTO, OPTIMIZE, read_files, http_request, ai_query, …), and more than one
 * statement. Checked on the text with string literals, quoted identifiers and comments removed,
 * so names like `UPDATED_AT` or 'delete' in a literal never trip it.
 *
 * This is defence in depth: the warehouse credential should itself be SELECT-only.
 */

export type SqlGateResult = { ok: true } | { ok: false; reason: string };

const WRITE_OR_ADMIN =
  /\b(INSERT|UPDATE|DELETE|MERGE|UPSERT|DROP|CREATE|ALTER|TRUNCATE|RENAME|REPLACE\s+TABLE|GRANT|REVOKE|DENY|COPY|OPTIMIZE|VACUUM|ANALYZE|REFRESH|RESTORE|CLONE|CACHE|UNCACHE|MSCK|CALL|EXECUTE|USE|SET|RESET|ADD\s+(?:JAR|FILE|ARCHIVE)|LOAD\s+DATA)\b/i;

/** Table-valued / scalar functions that read files, reach the network or spend money. */
const EXTERNAL_FNS =
  /\b(read_files|read_csv|read_json|read_parquet|cloud_files|read_kafka|read_kinesis|read_pubsub|read_pulsar|read_statestore|http_request|url_decode_remote|ai_query|ai_gen|ai_summarize|ai_translate|ai_classify|ai_extract|ai_analyze_sentiment|ai_fix_grammar|ai_mask|ai_similarity|ai_forecast|vector_search|java_method|reflect|secret|try_secret)\s*\(/i;

/** Remove comments, string literals and backtick-quoted identifiers. */
export function stripSqlLiterals(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const n = sql[i + 1];
    if (c === '-' && n === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += ' ';
      continue;
    }
    if (c === '/' && n === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += ' ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < sql.length) {
        if (sql[i] === '\\' && q !== '`') {
          i += 2;
          continue;
        }
        if (sql[i] === q) {
          if (sql[i + 1] === q) {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      i++;
      out += q === '`' ? ' _id_ ' : " '' ";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export function checkPbiSql(sql: string): SqlGateResult {
  const bare = stripSqlLiterals(sql).trim().replace(/;\s*$/, '');
  if (!bare) return { ok: false, reason: 'empty statement' };
  if (bare.includes(';')) return { ok: false, reason: 'more than one statement' };
  if (!/^\(*\s*(SELECT|WITH|VALUES)\b/i.test(bare)) {
    return { ok: false, reason: 'only SELECT / WITH / VALUES queries may run' };
  }
  const write = bare.match(WRITE_OR_ADMIN);
  if (write) return { ok: false, reason: `statement keyword ${write[1]!.toUpperCase()} is not allowed` };
  const ext = bare.match(EXTERNAL_FNS);
  if (ext) return { ok: false, reason: `function ${ext[1]} is not allowed` };
  return { ok: true };
}
