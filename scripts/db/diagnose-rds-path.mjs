#!/usr/bin/env node
/**
 * Isolate Windows RDS failures: raw TCP vs Prisma pooled vs Prisma cold reconnect.
 *
 *   npm run db:diag
 */
import net from 'node:net';
import { PrismaClient } from '@prisma/client';
import { tuneDatabaseUrl } from './tune-database-url.mjs';

const host = process.env.RDS_DIAG_HOST ?? 'aloft-dev-writer.c1a2qeam6xf0.ap-south-1.rds.amazonaws.com';
const port = Number(process.env.RDS_DIAG_PORT ?? 5432);
const rounds = Number(process.env.RDS_DIAG_ROUNDS ?? 5);
const pauseMs = Number(process.env.RDS_DIAG_PAUSE_MS ?? 500);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function tcpOnce() {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = net.connect({ host, port, timeout: 25_000 }, () => {
      const ms = Date.now() - start;
      socket.destroy();
      resolve({ ok: true, ms });
    });
    socket.on('error', (err) => {
      socket.destroy();
      resolve({ ok: false, ms: Date.now() - start, err: err.message });
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ ok: false, ms: Date.now() - start, err: 'ETIMEDOUT' });
    });
  });
}

async function phase(label, fn) {
  console.log(`\n=== ${label} ===`);
  let ok = 0;
  for (let i = 1; i <= rounds; i++) {
    const r = await fn(i);
    const line = `${i} ${r.ok ? 'ok' : 'FAIL'} ${r.ms}ms${r.err ? ` ${r.err}` : ''}`;
    console.log(line);
    if (r.ok) ok++;
    await sleep(pauseMs);
  }
  console.log(`→ ${ok}/${rounds} succeeded`);
  return ok;
}

function prismaClient() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    console.error('DATABASE_URL is not set (use --env-file=.env or .env.local)');
    process.exit(1);
  }
  const url = tuneDatabaseUrl(raw);
  return new PrismaClient({ datasources: { db: { url } } });
}

async function prismaQuery(client) {
  const start = Date.now();
  try {
    await client.$queryRawUnsafe('SELECT 1');
    return { ok: true, ms: Date.now() - start };
  } catch (e) {
    const msg = String(e?.message ?? e);
    const short =
      msg.split('\n').find((l) => /reach|timed|refused|ECONN|P1001|connection pool/i.test(l)) ??
      msg.slice(0, 140);
    return { ok: false, ms: Date.now() - start, err: short };
  }
}

async function warmClient(client, label) {
  const max = Number(process.env.RDS_DIAG_WARM_ATTEMPTS ?? 12);
  console.log(`\n=== ${label} (same pool settings as src/lib/db.ts: pool_timeout 60 on Windows) ===`);
  for (let attempt = 1; attempt <= max; attempt++) {
    const r = await prismaQuery(client);
    if (r.ok) {
      console.log(`warm ok on attempt ${attempt}/${max} (${r.ms}ms)`);
      return true;
    }
    console.log(`warm attempt ${attempt}/${max} FAIL ${r.ms}ms — ${r.err ?? ''}`);
    await sleep(Math.min(2500 * attempt, 20_000));
  }
  return false;
}

async function main() {
  console.log(`Target ${host}:${port} (${rounds} rounds, ${pauseMs}ms apart)`);
  console.log('Phase A = new TCP each time. Phase B = warm then reuse (how the app should behave).');

  const aOk = await phase('A) Raw TCP (new socket every time)', async () => tcpOnce());

  const pooled = prismaClient();
  const warm = await warmClient(pooled, 'B0) Prisma warm-up');
  let bOk = 0;
  if (warm) {
    bOk = await phase('B) Prisma pooled after warm (no $disconnect)', async () => prismaQuery(pooled));
  } else {
    console.log('\n=== B) Prisma pooled after warm ===');
    console.log('→ skipped (warm-up never succeeded)');
  }
  await pooled.$disconnect();

  await phase('C) Prisma cold (new client + $disconnect each round)', async () => {
    const c = prismaClient();
    const r = await prismaQuery(c);
    await c.$disconnect();
    return r;
  });

  console.log('\nInterpretation:');
  if (aOk < rounds) {
    console.log(
      `- A: ${aOk}/${rounds} — path to ${host} drops ~${Math.round((1 - aOk / rounds) * 100)}% of NEW TCP (often ~21s ETIMEDOUT). This is ISP/internet/RDS SG, not Vite/Next.`,
    );
  }
  if (warm && bOk === rounds) {
    console.log('- B0+B: warm then reuse succeeded — app should warm at startup (instrumentation.ts) + pool=1.');
  } else if (warm) {
    console.log(`- B: only ${bOk}/${rounds} after warm — connection may still be dropping; consider VPC dev or RDS Proxy.`);
  } else {
    console.log('- B0: could not warm — wait and retry db:diag, or fix network path to :5432.');
  }
  console.log('- C failing while B works → never $disconnect in app code; use npm run dev (unified on Windows).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});