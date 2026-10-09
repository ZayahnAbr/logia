import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authorizeUrl, msConfigured, newPkce } from "@/lib/server/onedrive";

// Starts "Connect OneDrive": authorization-code flow with PKCE. The state and code verifier wait in a short-lived
// httpOnly cookie until Microsoft sends the person back to /api/microsoft/callback.
export async function GET(request: NextRequest) {
  const { origin } = new URL(request.url);
  const back = (msg: string) => NextResponse.redirect(`${origin}/spaces/settings?onedrive=error&msg=${encodeURIComponent(msg)}#connections`);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/auth/signin`);
  if (!msConfigured()) return back("OneDrive isn't set up for this app yet.");

  const { verifier, challenge, state } = newPkce();
  const res = NextResponse.redirect(authorizeUrl(origin, state, challenge));
  res.cookies.set("ms_oauth", JSON.stringify({ state, verifier, uid: user.id }), {
    httpOnly: true, sameSite: "lax", secure: origin.startsWith("https://"), path: "/api/microsoft", maxAge: 600,
  });
  return res;
}
