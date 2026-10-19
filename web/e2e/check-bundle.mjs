/**
 * Fails if the production bundle contains server-only code. Ground truth is the built output, not an import-graph guess:
 * a single value-import of a server module from a client file (for example a constant exported next to a Prisma call)
 * silently drags Prisma, the AWS SDK or bcrypt into the browser.
 *
 *   npm run web:build && npm run web:check-bundle
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const assets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/assets');
const MARKERS = [
  ['Prisma client (browser stub)', '.prisma/client'],
  ['PrismaClient', 'PrismaClient'],
  ['AWS SDK', '@aws-sdk/'],
  ['AWS SDK (smithy)', '@smithy/'],
  ['bcryptjs', 'bcryptjs'],
  ['node-postgres', 'pg-protocol'],
  ['jose (server JWT)', 'jose/dist'],
  ['NEXTAUTH_SECRET', 'NEXTAUTH_SECRET'],
  ['DATABASE_URL', 'DATABASE_URL'],
];

export function scanBundle() {
  const hits = [];
  for (const f of readdirSync(assets).filter((n) => n.endsWith('.js'))) {
    const text = readFileSync(path.join(assets, f), 'utf8');
    for (const [label, needle] of MARKERS) if (text.includes(needle)) hits.push(`${f}: ${label} (${needle})`);
  }
  return hits;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hits = scanBundle();
  if (hits.length) {
    console.error(`Server-only code found in the browser bundle:\n  ${hits.join('\n  ')}`);
    process.exit(1);
  }
  console.log('bundle clean: no server-only markers in web/dist/assets');
}
