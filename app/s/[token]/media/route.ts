import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { WIDGET_BUCKET } from "@/lib/customWidgets";
import { HEADER_BUCKET } from "@/lib/spaceHeader";

// Pictures for a view link: the header image (?h=1) or an image sticker (?w=<sticker id>).
// The client never supplies a storage path. view_media_path() checks the link is live and returns the path only for
// a file the link may show; the storage policies (migration 40) allow exactly those files for the anon key, so a
// short-lived signed URL can be made without a service key.
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sp = request.nextUrl.searchParams;
  const widget = sp.get("w");
  const isHeader = sp.get("h") === "1";
  const gone = () => new NextResponse("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex", "Cache-Control": "no-store" } });
  if (!TOKEN_RE.test(token) || (!isHeader && !(widget && UUID_RE.test(widget)))) return gone();

  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc("view_media_path", {
    p_token: token, p_kind: isHeader ? "header" : "widget", p_id: isHeader ? null : widget,
  });
  if (error || typeof path !== "string" || !path) return gone();

  const { data: signed } = await supabase.storage.from(isHeader ? HEADER_BUCKET : WIDGET_BUCKET).createSignedUrl(path, 600);
  if (!signed?.signedUrl) return gone();

  return NextResponse.redirect(signed.signedUrl, {
    status: 302,
    headers: { "Cache-Control": "private, max-age=240", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" },
  });
}
