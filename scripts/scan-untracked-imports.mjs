import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const tracked = new Set(
  execSync('git ls-files', { encoding: 'utf8' })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean),
);

const untracked = execSync('git status -u --porcelain', { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter((l) => l.startsWith('??'))
  .map((l) => l.slice(3).trim().split(' -> ').pop());

const untrackedSet = new Set(untracked);

function resolveImport(imp) {
  const rel = imp.replace('@/', 'src/');
  const bases = [
    `${rel}.ts`,
    `${rel}.tsx`,
    path.join(rel, 'index.ts'),
    path.join(rel, 'index.tsx'),
  ];
  for (const b of bases) {
    const norm = b.replace(/\\/g, '/');
    if (fs.existsSync(b)) return norm;
  }
  return `${rel}.ts`.replace(/\\/g, '/');
}

function importsIn(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const m of text.matchAll(/from ['"](@\/[^'"]+)['"]/g)) out.push(m[1]);
  return out;
}

console.log('=== Tracked files importing modules not in git ===');
for (const f of tracked) {
  if (!/\.tsx?$/.test(f) || !fs.existsSync(f)) continue;
  for (const imp of importsIn(f)) {
    const target = resolveImport(imp);
    if (!fs.existsSync(target.replace(/\\/g, '/'))) {
      console.log(`${f} -> ${imp} (missing on disk)`);
    } else if (!tracked.has(target)) {
      console.log(`${f} -> ${imp} (${target} NOT TRACKED)`);
    }
  }
}

console.log('\n=== Importers of each untracked src file ===');
const byUntracked = new Map();
const allFiles = [...tracked, ...untracked].filter(
  (f) => /\.tsx?$/.test(f) && fs.existsSync(f),
);
for (const u of untracked.filter((p) => p.startsWith('src/'))) {
  byUntracked.set(u.replace(/\\/g, '/'), []);
}
for (const f of allFiles) {
  for (const imp of importsIn(f)) {
    const target = resolveImport(imp);
    if (untrackedSet.has(target) || untracked.includes(target)) {
      const key = target.replace(/\\/g, '/');
      if (!byUntracked.has(key)) byUntracked.set(key, []);
      byUntracked.get(key).push(f);
    }
  }
}
for (const [u, imps] of [...byUntracked.entries()].sort()) {
  if (!imps.length) continue;
  console.log(`\n${u}`);
  for (const i of imps) console.log(`  - ${i}`);
}
