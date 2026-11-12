import { spawnSync } from 'node:child_process';
import { inspect } from './block-destructive-db.mjs';

let failed = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed += 1;
    console.error(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
  }
}

check('select', inspect({ command: 'databricks experimental aitools tools query "SELECT 1 AS ok"' }), []);
check('show', inspect({ command: 'databricks catalogs list --profile synergy' }), []);
check('drop table', inspect({ command: 'spark.sql("drop table orders")' }), ['DROP']);
check('delete from', inspect({ command: 'DELETE FROM knowledge_chunks WHERE id = 1' }), ['DELETE FROM']);
check('truncate', inspect({ command: 'TRUNCATE TABLE orders' }), ['TRUNCATE']);
check('alter drop', inspect({ command: 'ALTER TABLE orders DROP COLUMN email' }), ['ALTER ... DROP']);
check('insert overwrite', inspect({ command: 'INSERT OVERWRITE orders SELECT * FROM staging' }), ['INSERT OVERWRITE']);
check('create or replace', inspect({ command: 'CREATE OR REPLACE TABLE orders AS SELECT 1' }), ['CREATE OR REPLACE']);
check('cli delete', inspect({ command: 'databricks catalogs delete main' }), ['databricks delete']);
check('quoted delete is not a cli delete', inspect({
  command: 'databricks experimental aitools tools query "SELECT note FROM t WHERE note = \'please delete\'"',
}), []);
check('print env', inspect({ command: 'Get-Content .env' }), ['printing .env']);
check('git add env', inspect({ command: 'git add .env' }), ['git add of .env']);
check('git status', inspect({ command: 'git status' }), []);
check('claude bash shape', inspect({
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'DELETE FROM orders' },
}), ['DELETE FROM']);
check('read env path', inspect({
  tool_name: 'Read',
  tool_input: { path: 'c:/ALOFT/aloft-ui-redesign/.env' },
}), ['reading or writing .env']);
check('beforeReadFile env', inspect({
  hook_event_name: 'beforeReadFile',
  file_path: '/Users/me/projects/aloft-d360/.env',
}), ['reading or writing .env']);
check('beforeReadFile attachment env', inspect({
  hook_event_name: 'beforeReadFile',
  file_path: '/safe/readme.md',
  attachments: [{ type: 'file', file_path: '/Users/me/projects/aloft-d360/.env.local' }],
}), ['reading or writing .env']);
check('prisma migrate reset', inspect({ command: 'npx prisma migrate reset' }), ['prisma migrate reset']);
check('prisma db push force', inspect({ command: 'prisma db push --force-reset' }), ['prisma db push (destructive)']);
check('edit source that mentions delete', inspect({
  tool_name: 'StrReplace',
  tool_input: {
    path: 'c:/ALOFT/aloft-ui-redesign/src/lib/knowledge/repo.ts',
    old_string: 'keep',
    new_string: 'DELETE FROM knowledge_chunks WHERE document_id = 1',
  },
}), []);
check('mcp sql', inspect({
  tool_name: 'mcp__databricks__query',
  tool_input: { statement: 'DROP TABLE sandbox.orders' },
}), ['DROP']);

const marker = 'SECRETVALUE99';
const denied = spawnSync(process.execPath, ['scripts/guards/block-destructive-db.mjs'], {
  input: JSON.stringify({ command: `echo ${marker}; DROP TABLE orders` }),
  encoding: 'utf8',
});
check('cli exit', denied.status, 2);
check('cli hides command text', denied.stdout.includes(marker) || denied.stderr.includes(marker), false);
check('cli deny permission', JSON.parse(denied.stdout).permission, 'deny');

const allowed = spawnSync(process.execPath, ['scripts/guards/block-destructive-db.mjs'], {
  input: JSON.stringify({ command: 'databricks warehouses list --profile synergy' }),
  encoding: 'utf8',
});
check('cli allow exit', allowed.status, 0);
check('cli allow permission', JSON.parse(allowed.stdout).permission, 'allow');

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log('all guard checks passed');
