import type { NextConfig } from "next";


// Pages that hold student work must never be indexed, even if a crawler reaches one through a
// leaked link. robots.txt asks politely; this header is the instruction search engines obey.
const PRIVATE_ROUTES = ["/spaces/:path*", "/discover/:path*", "/library/:path*", "/timetable/:path*", "/dashboard/:path*", "/invite/:path*", "/auth/:path*", "/api/:path*", "/loops/:path*", "/s/:path*"];

const nextConfig: NextConfig = {
  cacheComponents: false,
  async headers() {
    return PRIVATE_ROUTES.map((source) => ({
      source,
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
    }));
  },
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