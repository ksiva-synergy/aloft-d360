import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPEARANCE_BOOT_SCRIPT } from '../src/lib/theme/appearance';
import { THEME_COOKIE_NAME } from '../src/lib/theme/cookie';

/**
 * Vite + React Router v7 UI for Aloft. Run every script from the REPO ROOT (`npm run web:dev`),
 * because Tailwind resolves its `content` globs and `tailwind.config.js` relative to the cwd.
 *
 * The app reuses `src/` in place through the `@` alias, so there is no duplicated UI code and the
 * Next.js UI keeps working. Only four `next/*` modules are swapped for shims (see web/src/compat).
 */
const webDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webDir, '..');
const compat = (name: string) => path.resolve(webDir, 'src/compat', name);

/** Same two blocking scripts `app/layout.tsx` renders in <head>: no theme/accent flash before first paint. */
function bootScripts(): Plugin[] {
  const theme = `(function(){try{var d=document.documentElement,t=localStorage.getItem('theme'),isDark=t==='dark'||false;d.classList.add(isDark?'dark':'light');d.style.colorScheme=isDark?'dark':'light';document.cookie='${THEME_COOKIE_NAME}='+(isDark?'dark':'light')+';path=/;max-age=31536000;SameSite=Lax'}catch(e){}})();`;
  return [
    {
      name: 'aloft-boot-scripts',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) => html.replace('<!--BOOT_SCRIPTS-->', `<script>${theme}</script>
    <script>${APPEARANCE_BOOT_SCRIPT}</script>`),
      },
    },
    {
      // /public is served by Next at '/', but Vite prefixes public URLs with `base` (/spa/) in production builds.
      name: 'aloft-favicon-base',
      transformIndexHtml: {
        order: 'post',
        handler: (html) => html.replace(/(["'])\/spa\/(favicon[^"']*)/g, '$1/$2'),
      },
    },
  ];
}

const processEnv = {
  'process.env.NEXTAUTH_URL': 'undefined',
  'process.env.NEXTAUTH_URL_INTERNAL': 'undefined',
  'process.env.VERCEL_URL': 'undefined',
};

// Dev layout: the Vite UI owns :3000 (so NEXTAUTH_URL / the Azure AD redirect URI already point at it) and the Next.js
// API runs on :3001 (`npm run dev:api`). Override with WEB_PORT / WEB_API_TARGET.
const API_TARGET = process.env.WEB_API_TARGET ?? 'http://localhost:3001';

export default defineConfig(({ mode, command }) => ({
  root: webDir,
  // Production assets live under /spa/ so Next can serve them from public/spa without clashing with its own
  // /_next and /api paths; the router itself still runs at '/' (index.html is served for every page URL).
  base: command === 'build' ? '/spa/' : '/',
  // Repo-root `.env` holds server secrets; only `VITE_*` in web/.env* may reach the browser.
  envDir: webDir,
  publicDir: path.resolve(repoRoot, 'public'),
  plugins: [react(), bootScripts()],
  resolve: {
    // Most specific first (mirrors tsconfig.json / vitest.config.ts).
    alias: [
      { find: /^next\/link$/, replacement: compat('next-link.tsx') },
      { find: /^next\/navigation$/, replacement: compat('next-navigation.tsx') },
      { find: /^next\/dynamic$/, replacement: compat('next-dynamic.tsx') },
      { find: /^next\/image$/, replacement: compat('next-image.tsx') },
      { find: /^@\/components\/ui\/(.*)$/, replacement: path.resolve(repoRoot, 'packages/aloft-shared/src/components/ui') + '/$1' },
      { find: /^@\/lib\/utils$/, replacement: path.resolve(repoRoot, 'packages/aloft-shared/src/lib/utils') },
      { find: /^@\/(.*)$/, replacement: path.resolve(repoRoot, 'src') + '/$1' },
    ],
    dedupe: ['react', 'react-dom', 'react-router'],
  },
  // `estate/mapper/page.tsx` reads process.env.NODE_ENV in app code (Vite only replaces it inside deps in dev).
  // `next-auth/react` reads these three at module load; undefined gives it the same-origin `/api/auth` base path
  // (its client only uses `basePath` in the browser), so the session is fetched through the proxy.
  define: {
    ...processEnv,
    'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
  },
  optimizeDeps: { esbuildOptions: { define: { ...processEnv } } },
  css: { postcss: repoRoot },
  server: {
    port: Number(process.env.WEB_PORT ?? 3000),
    strictPort: true,
    proxy: {
      // The UI and the API share one origin from the browser's point of view, so next-auth cookies
      // stay first-party and there is no CORS. SSE streams (chat, logs) pass through unbuffered.
      '/api': {
        target: API_TARGET,
        changeOrigin: false,
        ws: false,
        configure: (proxy) => {
          // Without this the browser shows a bare HTTP 500 when the Next.js API is not running.
          proxy.removeAllListeners('error');
          proxy.on('error', (err, _req, res) => {
            console.warn(`[vite] API not reachable at ${API_TARGET} (${(err as NodeJS.ErrnoException).code ?? err.message}). Start it with \`npm run dev:api\` or use \`npm run dev:all\`.`);
            const r = res as import('node:http').ServerResponse;
            if (r && typeof r.writeHead === 'function' && !r.headersSent) {
              r.writeHead(503, { 'Content-Type': 'application/json' });
              r.end(JSON.stringify({ error: 'API_UNAVAILABLE', message: `The Next.js API is not running on ${API_TARGET}. Start it with: npm run dev:api` }));
            }
          });
        },
      },
    },
  },
  preview: { port: 4180, strictPort: true, proxy: { '/api': { target: API_TARGET, changeOrigin: false } } },
  build: {
    outDir: path.resolve(webDir, 'dist'),
    emptyOutDir: true,
    copyPublicDir: false, // /public is already served by Next at '/'
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
}));
