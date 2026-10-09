import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safeNext";
import { classroomMessage, runClassroomSync } from "@/lib/server/classroom";
import { GdocsError, storeGoogleRefreshToken } from "@/lib/server/gdocs";
import { TokenKeyError } from "@/lib/server/tokenCrypto";

// Handles both Google OAuth and password-reset email links — both redirect here with a `code`.
// `classroom=1` marks a "Connect Google Classroom" return: the Google access token that comes back with the
// session is used once, right here, to sync Classroom. It is not stored.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next")) ?? "/spaces";
  const classroom = searchParams.get("classroom") === "1";

  const gdocs = searchParams.get("gdocs") === "1";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // "Connect Google Docs": keep Google's refresh token, encrypted on the server, so notes can sync later.
      if (gdocs) {
        const dest = new URL("/spaces/settings", origin);
        dest.hash = "connections";
        const refresh = data.session?.provider_refresh_token;
        if (!refresh) {
          dest.searchParams.set("gdocs", "error");
          dest.searchParams.set("msg", "Google didn't pass the access back. Try connecting again.");
        } else {
          try {
            await storeGoogleRefreshToken(supabase, refresh);
            dest.searchParams.set("gdocs", "ok");
          } catch (e) {
            dest.searchParams.set("gdocs", "error");
            dest.searchParams.set("msg", e instanceof TokenKeyError ? "Google Docs isn't set up on this server yet." : e instanceof GdocsError ? e.message : "Couldn't save the Google Docs connection.");
          }
        }
        return NextResponse.redirect(dest);
      }
      if (classroom) {
        const token = data.session?.provider_token;
        const userId = data.session?.user.id;
        const dest = new URL("/spaces/settings", origin);
        dest.hash = "school-sync";
        if (!token || !userId) {
          dest.searchParams.set("classroom", "error");
          dest.searchParams.set("msg", "Google didn't pass Classroom access back. Try connecting again.");
        } else {
          try {
            const r = await runClassroomSync(supabase, userId, token);
            dest.searchParams.set("classroom", "ok");
            dest.searchParams.set("n", String(r.count));
          } catch (e) {
            dest.searchParams.set("classroom", "error");
            dest.searchParams.set("msg", classroomMessage(e));
          }
        }
        return NextResponse.redirect(dest);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/signin?error=Could not authenticate`);
}
