import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MsError, exchangeCode, msConfigured, storeMicrosoftRefreshToken } from "@/lib/server/onedrive";
import { TokenKeyError } from "@/lib/server/tokenCrypto";

// Microsoft sends the person back here with ?code=...&state=... . The code is exchanged with the PKCE verifier
// and the client secret, and only the refresh token is kept, encrypted. Nothing is returned to the browser.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const done = (kind: "ok" | "error", msg?: string) => {
    const dest = new URL("/spaces/settings", origin);
    dest.searchParams.set("onedrive", kind);
    if (msg) dest.searchParams.set("msg", msg);
    dest.hash = "connections";
    const res = NextResponse.redirect(dest);
    res.cookies.set("ms_oauth", "", { path: "/api/microsoft", maxAge: 0 });
    return res;
  };

  if (searchParams.get("error")) return done("error", searchParams.get("error") === "access_denied" ? "OneDrive wasn't connected because access was declined." : "Microsoft couldn't connect OneDrive.");
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  let saved: { state?: string; verifier?: string; uid?: string } = {};
  try { saved = JSON.parse(request.cookies.get("ms_oauth")?.value ?? "{}"); } catch { /* handled below */ }
  if (!code || !state || !saved.state || !saved.verifier || saved.state !== state) return done("error", "That connection attempt expired. Try connecting again.");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.id !== saved.uid) return done("error", "Sign in again, then connect OneDrive.");
  if (!msConfigured()) return done("error", "OneDrive isn't set up for this app yet.");

  try {
    const refresh = await exchangeCode(origin, code, saved.verifier);
    await storeMicrosoftRefreshToken(supabase, refresh);
    return done("ok");
  } catch (e) {
    return done("error", e instanceof MsError ? e.message : e instanceof TokenKeyError ? "OneDrive isn't set up on this server yet." : "Couldn't save the OneDrive connection.");
  }
}
