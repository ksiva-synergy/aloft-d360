/**
 * Blocks agent shell and MCP calls that would destroy data or reveal secrets.
 * Cursor: .cursor/hooks.json (beforeShellExecution, beforeMCPExecution, preToolUse)
 * Claude: .claude/settings.json (PreToolUse)
 *
 * Deny exits 2. Allow prints JSON and exits 0.
 * Reasons never echo the command, so a secret in the command is not repeated.
 */
import { readFileSync } from 'node:fs';

const SQL_RULES = [
  { re: /\bDROP\s+(TABLE|VIEW|SCHEMA|DATABASE|CATALOG|VOLUME|FUNCTION|INDEX|MATERIALIZED\s+VIEW)\b/i, label: 'DROP' },
  { re: /\bDELETE\s+FROM\b/i, label: 'DELETE FROM' },
  { re: /\bTRUNCATE\s+(TABLE\b|[A-Za-z0-9_`"[])/i, label: 'TRUNCATE' },
  { re: /\bALTER\b[\s\S]{0,300}\bDROP\b/i, label: 'ALTER ... DROP' },
  { re: /\bINSERT\s+OVERWRITE\b/i, label: 'INSERT OVERWRITE' },
  { re: /\bCREATE\s+OR\s+REPLACE\b/i, label: 'CREATE OR REPLACE' },
];

const SECRET_RULES = [
  { re: /\bgit\s+add\b[\s\S]{0,200}\.env\b/i, label: 'git add of .env' },
  { re: /\b(type|cat|Get-Content|gc|more)\s+[^\n]{0,160}\.env\b/i, label: 'printing .env' },
  { re: /\b(cp|copy|Copy-Item|Set-Content|Out-File)\b[\s\S]{0,180}\.env\b/i, label: 'copying .env' },
  { re: /\b(echo|print|printf|Write-Output|Write-Host)\b[\s\S]{0,80}\b(CLIENT_SECRET|API_KEY|SECRET_KEY)\b/i, label: 'printing a secret' },
  { re: /\bdatabricks\s+secrets\s+(get-secret|get)\b/i, label: 'reading a Databricks secret' },
];

const CLI_RULES = [
  { re: /\bdatabricks\b[\s\S]{0,160}\bfs\s+rm\b/i, label: 'databricks fs rm' },
  { re: /\bdatabricks\b[\s\S]{0,160}\b(tables|schemas|catalogs|volumes|pipelines)\s+delete\b/i, label: 'databricks delete' },
  { re: /\bdatabricks\b[\s\S]{0,160}\b(bundles?\s+)?destroy\b/i, label: 'databricks destroy' },
  { re: /\bprisma\b[\s\S]{0,120}\bmigrate\s+reset\b/i, label: 'prisma migrate reset' },
  { re: /\bprisma\b[\s\S]{0,120}\bdb\s+push\b[\s\S]{0,100}(?:--force-reset|--accept-data-loss)\b/i, label: 'prisma db push (destructive)' },
];

const FILE_TOOLS = /^(Read|Write|StrReplace|TabRead|TabWrite|Edit|ApplyPatch)$/i;

function stripQuotes(text) {
  return text
    .replace(/"(?:\\.|[^"\\])*"/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, ' ');
}

function labels(text, rules) {
  return rules.filter((rule) => rule.re.test(text)).map((rule) => rule.label);
}

const PATH_KEYS = new Set([
  'path', 'file_path', 'filePath', 'target_file', 'targetFile', 'uri', 'filename', 'file',
]);

function collectPaths(node, found) {
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string' && PATH_KEYS.has(key)) found.push(value);
    else if (value && typeof value === 'object') collectPaths(value, found);
  }
}

function isEnvFile(filePath) {
  const base = filePath.replace(/\\/g, '/').split('/').pop() || '';
  return base === '.env' || base.startsWith('.env.');
}

export function inspect(payload) {
  const tool = String(payload.tool_name || payload.tool || '');
  const reasons = [];
  const hookEvent = String(payload.hook_event_name || '');

  // Cursor beforeReadFile / beforeTabFileRead: file_path at root + optional attachments (see cursor.com/docs/hooks)
  if (hookEvent === 'beforeReadFile' || hookEvent === 'beforeTabFileRead') {
    const readPaths = [];
    if (typeof payload.file_path === 'string') readPaths.push(payload.file_path);
    if (Array.isArray(payload.attachments)) {
      for (const a of payload.attachments) {
        if (a && typeof a.file_path === 'string') readPaths.push(a.file_path);
      }
    }
    if (readPaths.some(isEnvFile)) reasons.push('reading or writing .env');
    return reasons;
  }

  const paths = [];
  collectPaths(payload.tool_input ?? payload.input ?? {}, paths);

  const input = payload.tool_input ?? payload.input ?? {};
  const fileEdit = FILE_TOOLS.test(tool) || (
    input && typeof input === 'object' && !payload.command && (
      'old_string' in input || 'new_string' in input || 'contents' in input || 'content' in input
    )
  );
  if (fileEdit) {
    if (paths.some(isEnvFile)) reasons.push('reading or writing .env');
    return reasons;
  }

  const command = [payload.command, payload.tool_input, payload.input]
    .filter((part) => part != null && part !== '')
    .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
    .join('\n');
  reasons.push(...labels(command, SQL_RULES));
  reasons.push(...labels(command, SECRET_RULES));
  reasons.push(...labels(stripQuotes(command), CLI_RULES));
  return reasons;
}

function message(reasons) {
  return `Blocked (${reasons.join(', ')}). Live DROP, DELETE, TRUNCATE, INSERT OVERWRITE, CREATE OR REPLACE, and ALTER that drops objects are not allowed. Do not print, copy, or commit .env secrets. Use SELECT, SHOW, DESCRIBE, or EXPLAIN.`;
}

function emit(payload, reasons) {
  const hookEvent = String(payload.hook_event_name || '');
  const tabRead = hookEvent === 'beforeTabFileRead';

  if (reasons.length === 0) {
    if (payload.hook_event_name === 'PreToolUse') {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
        },
      }));
    } else {
      process.stdout.write(JSON.stringify({ permission: 'allow' }));
    }
    process.exit(0);
  }

  const text = message(reasons);
  if (payload.hook_event_name === 'PreToolUse') {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: text,
      },
    }));
  } else if (tabRead) {
    // beforeTabFileRead schema: permission only (no user_message)
    process.stdout.write(JSON.stringify({ permission: 'deny' }));
  } else {
    process.stdout.write(JSON.stringify({
      permission: 'deny',
      user_message: text,
      agent_message: text,
    }));
  }
  process.stderr.write(`${text}\n`);
  process.exit(2);
}

function main() {
  const raw = readFileSync(0, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!raw) {
    process.stdout.write(JSON.stringify({ permission: 'allow' }));
    process.exit(0);
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    const text = 'Blocked. The database policy hook could not read the tool call, so it failed closed.';
    process.stdout.write(JSON.stringify({ permission: 'deny', user_message: text, agent_message: text }));
    process.stderr.write(`${text}\n`);
    process.exit(2);
  }
  emit(payload, inspect(payload));
}

if (process.argv[1] && process.argv[1].endsWith('block-destructive-db.mjs')) {
  try {
    main();
  } catch (error) {
    const text = 'Blocked. The database policy hook failed closed.';
    process.stdout.write(JSON.stringify({ permission: 'deny', user_message: text, agent_message: text }));
    process.stderr.write(`${text}\n`);
    process.exit(2);
  }
}
