import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Signs the student out and sends them to the landing page. POST only, so a link or image can't log anyone out.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const res = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  // Drop anything the browser kept from the signed-in session, so Back shows the sign-in page, not old content.
  res.headers.set("Clear-Site-Data", '"cache"');
  res.headers.set("Cache-Control", "no-store");
  return res;
}
