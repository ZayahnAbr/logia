import type { MetadataRoute } from "next";

// Only the landing and marketing pages may be indexed. Everything students create (spaces, notes,
// files, decks, Discover, the library) sits behind sign-in already; this is a second line of defence
// so a stray link never ends up in search results.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/$", "/features", "/pricing", "/donate", "/legal"],
        disallow: ["/spaces", "/discover", "/library", "/timetable", "/dashboard", "/invite", "/auth", "/api", "/loops", "/s/"],
      },
    ],
  };
}
