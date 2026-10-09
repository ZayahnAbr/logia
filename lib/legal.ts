// Bump TERMS_VERSION when the Terms, Acceptable Use or Privacy Policy change in a way people must re-accept.
// Plain module (no "use client") so server and client code can both import it.
export const TERMS_VERSION = "2026-10-beta-1";

export type AgeChoice = "" | "18+" | "13-17" | "under13";

export const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

// Shown in the legal pages. Set NEXT_PUBLIC_CONTACT_EMAIL to a public support address before launch.
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "adminlogia@gmail.com";
export const EFFECTIVE_DATE = "9 October 2026";
