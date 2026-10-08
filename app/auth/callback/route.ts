import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { classroomMessage, runClassroomSync } from "@/lib/server/classroom";

// Handles both Google OAuth and password-reset email links — both redirect here with a `code`.
// `classroom=1` marks a "Connect Google Classroom" return: the Google access token that comes back with the
// session is used once, right here, to sync Classroom. It is not stored.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/spaces";
  const classroom = searchParams.get("classroom") === "1";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
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
