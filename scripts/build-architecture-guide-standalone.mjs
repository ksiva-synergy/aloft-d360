/**
 * Builds one fully self-contained architecture-guide.html from architecture-guide.source.html
 * (local docs/*.css/js + cached CDN vendor bundle inlined).
 *
 * Run via: node scripts/embed-architecture-guides.mjs
 */
import fs from 'fs';
import path from 'path';
import { ensureVendorBundle, OFFLINE_FONT_CSS } from './lib/architecture-guide-vendor.mjs';

const root = path.join(import.meta.dirname, '..');
const srcPath = path.join(root, 'architecture-guide.source.html');
const outPath = path.join(root, 'architecture-guide.html');
const legacyStandalone = path.join(root, 'architecture-guide-standalone.html');

/** Vendor JS often contains backticks — never wrap in template literals. */
function inlineScript(label, code) {
  const safe = code.replace(/<\/script/gi, '<\\/script');
  return '<script>\n/* inlined ' + label + ' */\n' + safe + '\n</script>';
}

function inlineStyle(label, code) {
  return '<style>\n/* inlined ' + label + ' */\n' + code + '\n</style>';
}

/** String.replace treats $& / $1 / $' in the replacement as special — use a function replacer. */
function replaceOnce(html, needle, replacement) {
  if (!html.includes(needle)) return html;
  return html.replace(needle, () => replacement);
}

if (!fs.existsSync(srcPath)) {
  console.error('Missing architecture-guide.source.html');
  process.exit(1);
}

let html = fs.readFileSync(srcPath, 'utf8');

const googleFontsImport =
  "@import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&amp;family=IBM+Plex+Mono:wght@400;500&amp;family=Source+Serif+4:wght@700&amp;display=swap');";
if (html.includes(googleFontsImport)) {
  html = html.replace(
    googleFontsImport,
    `/* Google Fonts → system stacks (offline bundle) */\n${OFFLINE_FONT_CSS}`
  );
}

const vendor = await ensureVendorBundle(root);

const cdnScripts = [
  {
    needle: '<script src="https://cdn.tailwindcss.com"></script>',
    body: vendor.tailwind,
    label: 'tailwind.cdn',
  },
  {
    needle: '<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>',
    body: vendor.mermaid,
    label: 'mermaid@10',
  },
];

for (const { needle, body, label } of cdnScripts) {
  if (html.includes(needle)) {
    html = replaceOnce(html, needle, inlineScript(label, body));
  } else if (!html.includes('/* inlined ' + label + ' */')) {
    console.warn('CDN script tag not found:', label);
  }
}

const faNeedle =
  '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">';
if (html.includes(faNeedle)) {
  html = replaceOnce(html, faNeedle, inlineStyle('font-awesome 6.5.1', vendor.fontAwesome));
}

const localScripts = [
  'docs/semantic-layer-guide-init.js',
  'docs/architecture-module-guide-init.js',
  'docs/self-improving-guide-arch-init.js',
];
const localStyles = ['docs/semantic-layer-guide-arch.css', 'docs/architecture-module-rich.css', 'docs/architecture-catalog-ui.css'];

for (const href of localScripts) {
  const abs = path.join(root, href);
  if (!fs.existsSync(abs)) {
    console.warn('Skip missing script:', href);
    continue;
  }
  const code = fs.readFileSync(abs, 'utf8');
  const needle = `<script src="${href}"></script>`;
  if (!html.includes(needle)) {
    if (html.includes(`/* inlined ${href} */`)) continue;
    console.warn('Script tag not found in source:', href);
    continue;
  }
  html = replaceOnce(html, needle, inlineScript(href, code));
}

for (const href of localStyles) {
  const abs = path.join(root, href);
  if (!fs.existsSync(abs)) {
    console.warn('Skip missing stylesheet:', href);
    continue;
  }
  const code = fs.readFileSync(abs, 'utf8');
  const needle = `<link rel="stylesheet" href="${href}">`;
  if (!html.includes(needle)) {
    if (html.includes(`/* inlined ${href} */`)) continue;
    console.warn('Link tag not found in source:', href);
    continue;
  }
  html = replaceOnce(html, needle, inlineStyle(href, code));
}

const banner = `<!-- OFFLINE single-file guide. Edit architecture-guide.source.html; rebuild: node scripts/embed-architecture-guides.mjs -->\n`;
if (!html.includes('OFFLINE single-file guide')) {
  html = html.replace('<!DOCTYPE html>', `<!DOCTYPE html>\n${banner}`);
}

const doctypeCount = (html.match(/<!DOCTYPE html>/gi) || []).length;
if (doctypeCount > 2) {
  console.error(
    `Build sanity check failed: expected at most 2 <!DOCTYPE html> (banner + root), found ${doctypeCount}.`
  );
  process.exit(1);
}
const headEnd = html.indexOf('</head>');
const headChunk = headEnd > 0 ? html.slice(0, headEnd) : html.slice(0, 50000);
if (/<script\s+src="https?:\/\//i.test(headChunk)) {
  console.error('Build sanity check failed: external <script src="https://..."> still in <head>.');
  process.exit(1);
}

fs.writeFileSync(outPath, html);
if (fs.existsSync(legacyStandalone)) fs.unlinkSync(legacyStandalone);

const mb = (fs.statSync(outPath).size / (1024 * 1024)).toFixed(2);
console.log(`OK: wrote ${outPath} (${mb} MB) — fully offline; open this file only.`);
