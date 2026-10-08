import type { NextConfig } from "next";


const nextConfig: NextConfig = {
  cacheComponents: false,
  experimental: {
    // The on-disk dev cache kept serving a stale route table after restarts (nested
    // /spaces/[id]/* pages 404ed). Fresh compiles are a little slower but correct.
    turbopackFileSystemCacheForDev: false,
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
};

export default nextConfig;