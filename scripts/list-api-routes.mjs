import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app', 'api');

function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, acc);
    else if (name === 'route.ts') {
      const rel = path.relative(apiRoot, path.dirname(full)).replace(/\\/g, '/');
      acc.push(`/api/${rel}`);
    }
  }
}

const routes = [];
walk(apiRoot, routes);
routes.sort();

const byPrefix = {};
for (const r of routes) {
  const parts = r.split('/').filter(Boolean);
  const prefix = parts.length >= 2 ? `/${parts[0]}/${parts[1]}` : r;
  (byPrefix[prefix] ??= []).push(r);
}

const lines = [
  '# Generated API route list',
  '',
  `**Generated:** ${new Date().toISOString().slice(0, 10)}`,
  `**Total:** ${routes.length} route handlers`,
  '',
  '## By prefix',
  '',
];

for (const [prefix, list] of Object.entries(byPrefix).sort((a, b) => a[0].localeCompare(b[0]))) {
  lines.push(`### \`${prefix}/*\` (${list.length})`, '');
  for (const r of list) lines.push(`- \`${r}\``);
  lines.push('');
}

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'api-routes.generated.md');
fs.writeFileSync(out, lines.join('\n'));
console.log(`Wrote ${routes.length} routes to ${path.relative(process.cwd(), out)}`);
