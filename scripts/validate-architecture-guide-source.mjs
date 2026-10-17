/**
 * Quick sanity checks on architecture-guide.source.html before/after build.
 * Run: node scripts/validate-architecture-guide-source.mjs
 */
import fs from 'fs';
import path from 'path';

const srcPath = path.join(import.meta.dirname, '..', 'architecture-guide.source.html');
const html = fs.readFileSync(srcPath, 'utf8');

let failed = 0;

function fail(msg) {
  console.error('FAIL:', msg);
  failed++;
}

function ok(msg) {
  console.log('OK:', msg);
}

if (!html.includes("pageContents['repo-documentation']") && !html.includes("'repo-documentation':")) {
  fail('missing repo-documentation page');
} else {
  ok('repo-documentation page present');
}

const brokenDbNav = /Self-improving memory guide<\/button>←/;
if (brokenDbNav.test(html)) {
  fail('broken database-tables nav markup');
} else {
  ok('database-tables nav markup');
}

const mermaidBlocks = [
  ...html.matchAll(/<(?:div|pre)\s+class="mermaid"\s*>([\s\S]*?)<\/(?:div|pre)>/gi),
].map((m) => m[1].trim());
const emojiInMermaid = mermaidBlocks.filter((b) => /[\u{1F300}-\u{1FAFF}]/u.test(b));
if (emojiInMermaid.length) {
  fail(`emoji inside ${emojiInMermaid.length} mermaid block(s) — often breaks Mermaid 10`);
} else {
  ok('no emoji in mermaid blocks');
}

const starInNode = mermaidBlocks.filter((b) => /\[\([^\)]*\*[^\)]*\)\]/.test(b));
if (starInNode.length) {
  fail(`asterisk in mermaid node label in ${starInNode.length} block(s)`);
} else {
  ok('no asterisk node labels in mermaid');
}

const secretPatterns = [
  /AKIA[0-9A-Z]{16}/,
  /sk-[a-zA-Z0-9]{20,}/,
  /FOUNDRY_API_KEY\s*=\s*['"][^'"]+['"]/,
  /AWS_SECRET_ACCESS_KEY\s*=\s*['"][^'"]+['"]/,
];
for (const re of secretPatterns) {
  if (re.test(html)) fail(`possible secret pattern: ${re}`);
  else ok(`no match for ${re}`);
}

if (!html.includes('data-nav-page="platform-deploy"')) {
  fail('repo nav should use data-nav-page for platform-deploy');
} else {
  ok('repo sidebar uses data-nav-page');
}

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
