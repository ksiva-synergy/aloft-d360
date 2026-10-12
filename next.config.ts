import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@aloft/shared"],
  // Parent monorepo has its own package-lock.json; pin tracing/root to this app
  // so `next start` looks for `.next` here instead of C:\ALOFT.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
