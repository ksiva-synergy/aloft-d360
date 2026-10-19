const SECRET_KEYS = /^(client_secret|authorization|password|token|api_key|secret)$/i;
const SQL_TRUNCATE = 500;
const MAX_JSON_BYTES = parseInt(process.env.AGENT_OPS_MAX_PAYLOAD_BYTES ?? '8192', 10);

function truncateString(s: string, max: number): { value: string; truncated: boolean } {
  if (s.length <= max) return { value: s, truncated: false };
  return { value: s.slice(0, max), truncated: true };
}

function redactValue(key: string, value: unknown, depth = 0): unknown {
  if (depth > 8) return '[max-depth]';
  if (SECRET_KEYS.test(key)) return '[REDACTED]';

  if (typeof value === 'string') {
    if (key === 'statement' || key === 'sql' || key === 'query') {
      const t = truncateString(value, SQL_TRUNCATE);
      return t.truncated ? { _truncated: true, preview: t.value } : value;
    }
    return value.length > 2000 ? value.slice(0, 2000) + '…' : value;
  }

  if (Array.isArray(value)) {
    if (key === 'rows' || key === 'data_array') {
      return { _omitted: 'rows', length: value.length };
    }
    return value.slice(0, 20).map((v, i) => redactValue(String(i), v, depth + 1));
  }

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(k, v, depth + 1);
    }
    return out;
  }

  return value;
}

export function redactToolPayload(input: unknown): unknown {
  if (input == null) return null;
  if (typeof input !== 'object') return input;
  const redacted = redactValue('root', input, 0);
  const str = JSON.stringify(redacted);
  if (str.length <= MAX_JSON_BYTES) return redacted;
  return { _truncated: true, preview: str.slice(0, MAX_JSON_BYTES) };
}

export function redactToolOutput(toolName: string, output: unknown): unknown {
  if (output == null) return null;
  let parsed: unknown = output;
  if (typeof output === 'string') {
    try {
      parsed = JSON.parse(output);
    } catch {
      const t = truncateString(output, MAX_JSON_BYTES);
      return t.truncated ? { _truncated: true, preview: t.value } : output;
    }
  }
  if (toolName === 'execute_tool' && parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    return redactToolPayload({
      row_count: o.row_count,
      truncated: o.truncated,
      statement_id: o.statement_id,
      columns: o.columns,
      error: o.error,
    });
  }
  return redactToolPayload(parsed);
}

export function extractToolErrorFromJson(result: string): string | undefined {
  try {
    const j = JSON.parse(result) as { error?: unknown; message?: string };
    if (j.error !== undefined && j.error !== null) {
      return typeof j.error === 'string' ? j.error : JSON.stringify(j.error).slice(0, 500);
    }
  } catch {
    /* not json */
  }
  return undefined;
}
