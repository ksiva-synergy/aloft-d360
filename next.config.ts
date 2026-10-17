import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@aloft/shared"],
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
