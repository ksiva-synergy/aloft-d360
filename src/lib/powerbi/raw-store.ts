import 'server-only';

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FabricDefinitionPart } from '@/lib/powerbi/fabric';

/** Local or mounted raw store (gitignored `powerbi-estate/` by default). */
export function getPbiRawStoreRoot(): string {
  const fromEnv = process.env.PBI_RAW_STORE_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), 'powerbi-estate');
}

export function hashDefinitionParts(parts: FabricDefinitionPart[]): string {
  const h = createHash('sha256');
  for (const part of parts) {
    h.update(part.path);
    h.update('\0');
    h.update(part.payload);
    h.update('\0');
  }
  return h.digest('hex').slice(0, 32);
}

export function writeDefinitionParts(
  kind: 'definitions' | 'report-definitions' | 'report-definitions-legacy',
  itemId: string,
  parts: FabricDefinitionPart[],
): { absDir: string; relativeDir: string; partCount: number; contentHash: string } {
  const root = getPbiRawStoreRoot();
  const relDir = path.join(kind, itemId);
  const absDir = path.join(root, relDir);

  if (fs.existsSync(absDir)) {
    for (const ent of fs.readdirSync(absDir, { withFileTypes: true })) {
      const p = path.join(absDir, ent.name);
      if (ent.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
      else fs.unlinkSync(p);
    }
  }

  for (const part of parts) {
    const target = path.join(absDir, part.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(part.payload, 'base64'));
  }

  const contentHash = hashDefinitionParts(parts);
  return {
    absDir,
    relativeDir: relDir.replace(/\\/g, '/'),
    partCount: parts.length,
    contentHash,
  };
}
