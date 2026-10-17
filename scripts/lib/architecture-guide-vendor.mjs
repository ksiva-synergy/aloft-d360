/**
 * Cached CDN assets for a fully offline architecture-guide.html.
 * Populated on first build (network); reused from docs/vendor/architecture-guide/.
 */
import fs from 'fs';
import path from 'path';

const URLS = {
  tailwind: 'https://cdn.tailwindcss.com',
  mermaid: 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js',
  fontAwesomeCss: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  fontAwesomeBase: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/',
};

const FILES = {
  tailwind: 'tailwind.cdn.js',
  mermaid: 'mermaid.min.js',
  fontAwesomeRaw: 'fontawesome.all.min.css',
  fontAwesomeInline: 'fontawesome.all.inline.css',
};

export function vendorDir(root) {
  return path.join(root, 'docs', 'vendor', 'architecture-guide');
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return await res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function mimeForFont(url) {
  if (url.endsWith('.woff2')) return 'font/woff2';
  if (url.endsWith('.woff')) return 'font/woff';
  if (url.endsWith('.ttf')) return 'font/ttf';
  return 'application/octet-stream';
}

/** Rewrite url(...) in CSS to data URIs (Font Awesome webfonts). */
export async function inlineFontUrls(css, baseUrl) {
  const re = /url\((['"]?)([^'")]+)\1\)/g;
  const seen = new Map();
  let out = css;
  const matches = [...css.matchAll(re)];
  for (const m of matches) {
    const raw = m[2];
    if (raw.startsWith('data:')) continue;
    const abs = new URL(raw, baseUrl).href;
    if (!seen.has(abs)) {
      const buf = await fetchBuffer(abs);
      const data = `data:${mimeForFont(abs)};base64,${buf.toString('base64')}`;
      seen.set(abs, data);
    }
    out = out.split(m[0]).join(`url(${seen.get(abs)})`);
  }
  return out;
}

export async function ensureVendorBundle(root) {
  const dir = vendorDir(root);
  fs.mkdirSync(dir, { recursive: true });

  const tailPath = path.join(dir, FILES.tailwind);
  const mermaidPath = path.join(dir, FILES.mermaid);
  const faRawPath = path.join(dir, FILES.fontAwesomeRaw);
  const faInlinePath = path.join(dir, FILES.fontAwesomeInline);

  if (!fs.existsSync(tailPath)) {
    console.log('Downloading Tailwind CDN script…');
    fs.writeFileSync(tailPath, await fetchText(URLS.tailwind));
  }
  if (!fs.existsSync(mermaidPath)) {
    console.log('Downloading Mermaid…');
    fs.writeFileSync(mermaidPath, await fetchText(URLS.mermaid));
  }
  if (!fs.existsSync(faRawPath)) {
    console.log('Downloading Font Awesome CSS…');
    fs.writeFileSync(faRawPath, await fetchText(URLS.fontAwesomeCss));
  }
  if (!fs.existsSync(faInlinePath)) {
    console.log('Inlining Font Awesome webfonts (one-time)…');
    const raw = fs.readFileSync(faRawPath, 'utf8');
    const inlined = await inlineFontUrls(raw, URLS.fontAwesomeBase);
    fs.writeFileSync(faInlinePath, inlined);
  }

  return {
    tailwind: fs.readFileSync(tailPath, 'utf8'),
    mermaid: fs.readFileSync(mermaidPath, 'utf8'),
    fontAwesome: fs.readFileSync(faInlinePath, 'utf8'),
  };
}

export const OFFLINE_FONT_CSS = `
/* Offline bundle: no Google Fonts — system stacks match design intent */
body, .font-sans { font-family: 'Segoe UI', system-ui, -apple-system, 'Inter Tight', sans-serif; }
.font-mono { font-family: 'IBM Plex Mono', Consolas, ui-monospace, monospace; }
.font-serif { font-family: 'Source Serif 4', Georgia, 'Times New Roman', serif; }
`;
