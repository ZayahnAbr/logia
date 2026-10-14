import "../learn-layout.css";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSpace, getNotes, getNotebooks } from "@/lib/queries";
import { COVER_BUCKET, parseCover } from "@/lib/notebookCovers";
import { NotesBoard } from "./NotesBoard";

export default async function NotesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [space, notes, nb] = await Promise.all([getSpace(id), getNotes(id), getNotebooks(id)]);

  // Uploaded covers live in a private bucket: hand the browser short-lived signed links. cover_value may carry
  // a "#x,y" drag-to-reposition suffix (lib/notebookCovers.ts), so sign the underlying path, not the raw value.
  const paths = [...new Set([
    ...nb.rows.filter((b: any) => b.cover_kind === "image").map((b: any) => parseCover({ kind: b.cover_kind, value: b.cover_value })?.path),
    ...notes.filter((n: any) => n.cover_kind === "image").map((n: any) => parseCover({ kind: n.cover_kind, value: n.cover_value })?.path),
  ].filter(Boolean) as string[])];
  const coverUrls: Record<string, string> = {};
  if (paths.length) {
    const { data } = await supabase.storage.from(COVER_BUCKET).createSignedUrls(paths, 60 * 60);
    for (const r of data ?? []) if (r.path && r.signedUrl) coverUrls[r.path] = r.signedUrl;
  }

  return (
    <>
      <div className="phead phead-grad ln-phead">
        <div className="eyebrow">{space?.name}</div>
        <h1>Notes</h1>
        <div className="sub">Write, organise and search your notes.</div>
      </div>
      <NotesBoard spaceId={id} userId={user.id} notes={notes as any} notebooks={nb.rows as any} notebooksReady={nb.ready} coverUrls={coverUrls} />
    </>
  );
}
