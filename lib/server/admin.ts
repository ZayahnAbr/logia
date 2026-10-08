import "server-only";

// Same two admins as the unmetered AI accounts. RLS in migration 22 checks the same emails via the JWT.
const ADMINS = new Set(["zayahnabrahams1@gmail.com", "zayahnabrahams2004@gmail.com"]);
export const isAdmin = (email?: string | null) => !!email && ADMINS.has(email.toLowerCase());
