import type { NextConfig } from "next";


// Pages that hold student work must never be indexed, even if a crawler reaches one through a
// leaked link. robots.txt asks politely; this header is the instruction search engines obey.
const PRIVATE_ROUTES = ["/spaces/:path*", "/discover/:path*", "/library/:path*", "/timetable/:path*", "/dashboard/:path*", "/invite/:path*", "/auth/:path*", "/api/:path*", "/loops/:path*", "/s/:path*"];

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  cacheComponents: false,
  async headers() {
    // Signed-in pages are never kept by the browser, so Back after signing out can't show a cached copy.
    const signedIn = ["/spaces/:path*", "/discover/:path*", "/library/:path*", "/timetable/:path*", "/invite/:path*"];
    return PRIVATE_ROUTES.map((source) => ({
      source,
      headers: [
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ...(signedIn.includes(source) ? [{ key: "Cache-Control", value: "no-store, max-age=0" }] : []),
      ],
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