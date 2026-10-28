import type { NextConfig } from "next";
import path from "path";

/**
 * Next.js is the API and auth server only. The browser UI is the Vite + React Router app in /web, built to
 * `public/spa` by `npm run build` (see web/scripts/prepare-spa.mjs). Every page URL is answered with the SPA's
 * index.html; Next keeps serving /api/**, /_next/**, /spa/** and static files.
 * NOTE: rewrites are baked in at build time.
 */
const nextConfig: NextConfig = {
  output: "standalone",
  // Lets a verification build run beside a developer's `.next` (which `next dev` uses) without touching it.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async rewrites() {
    return {
      beforeFiles: [
        // Everything except API, Next internals, the SPA's own assets and anything that looks like a file.
        { source: "/:path((?!api/|_next/|spa/)[^.]*)", destination: "/spa/index.html" },
        { source: "/", destination: "/spa/index.html" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      { source: "/spa/index.html", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
      { source: "/spa/assets/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
  transpilePackages: ["@aloft/shared"],
  // Document extraction (src/lib/extraction/render.ts): pdf.js loads its worker module at run time
  // and @napi-rs/canvas is a native addon, so both must be required from node_modules, not bundled.
  // Knowledge bases (src/lib/knowledge/readers.ts): @firecrawl/pdf-inspector is a native addon too.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas", "@firecrawl/pdf-inspector"],
  // Parent monorepo has its own package-lock.json; pin tracing/root to this app
  // so `next start` looks for `.next` here instead of C:\ALOFT.
  outputFileTracingRoot: path.join(__dirname),
  experimental: {
    // Import only the icons/modules a file uses instead of whole barrel files;
    // the icon packs alone are thousands of modules per page compile.
    optimizePackageImports: [
      "@phosphor-icons/react",
      "lucide-react",
      "framer-motion",
      "echarts",
      "recharts",
      "@xyflow/react",
    ],
  },
};

export default nextConfig;
