"use server";
import { revalidatePath } from "next/cache";
import { authed, friendlyError } from "@/lib/server/llm";
import { notebookIdForName } from "@/lib/server/notebooks";
import { reindexSource, noteText } from "@/lib/server/rag";
import { fetchShared, ImportError, MAX_IMPORT_BYTES } from "@/lib/server/linkImport";
import { fileToNoteHtml, EDITABLE_RE } from "@/lib/server/fileToNote";

// Download a public share link into the space's files, like an upload. No API keys: the file must be
// shared as "anyone with the link".
export async function importFromLink(spaceId: string, folder: string, link: string) {
  const { supabase, user } = await authed();
  try {
    const { buffer, name, mime } = await fetchShared(link);
    if (buffer.length > MAX_IMPORT_BYTES) return { error: "That file is over the 25 MB limit." };
    const safeName = name.replace(/[^\w.\-]/g, "_");
    const path = `${spaceId}/${crypto.randomUUID()}-${safeName}`;
    const { error: upErr } = await supabase.storage.from("space-files").upload(path, buffer, { contentType: mime, upsert: false });
    if (upErr) return { error: upErr.message };
    const { data, error: dbErr } = await supabase.from("files")
      .insert({ space_id: spaceId, folder: folder.trim().slice(0, 40) || "General", name, path, size_bytes: buffer.length, mime_type: mime, uploaded_by: user.id })
      .select("id").single();
    if (dbErr) { await supabase.storage.from("space-files").remove([path]); return { error: dbErr.message }; }
    revalidatePath(`/spaces/${spaceId}/files`);
    return { id: data.id as string, name, path, mime, size: buffer.length };
  } catch (e) {
    if (e instanceof ImportError) return { error: e.message };
    return { error: friendlyError(e, "import that link") };
  }
}

// Turn an uploaded DOCX, PPTX, TXT or MD file into an editable Logia note. The original file is kept unchanged.
export async function openFileAsNote(spaceId: string, fileId: string) {
  const { supabase, user } = await authed();
  try {
    const { data: row } = await supabase.from("files").select("name, path").eq("id", fileId).eq("space_id", spaceId).maybeSingle();
    if (!row) return { error: "Couldn't find that file." };
    if (!EDITABLE_RE.test(row.name)) return { error: "Only Word, PowerPoint, text and Markdown files can be converted. For PDFs, use Extract text or Make notes." };
    const { data: blob, error: dlErr } = await supabase.storage.from("space-files").download(row.path);
    if (dlErr || !blob) return { error: "Couldn't open the file." };
    const buf = Buffer.from(await blob.arrayBuffer());
    if (buf.length > MAX_IMPORT_BYTES) return { error: "That file is over the 25 MB limit." };
    const html = (await fileToNoteHtml(row.name, buf)).slice(0, 1_900_000);
    const title = row.name.replace(/\.[^.]+$/, "").slice(0, 120) || "Imported note";
    const nbId = await notebookIdForName(supabase, spaceId, user.id, "From files");
    const { data, error } = await supabase.from("notes")
      .insert({ space_id: spaceId, folder: "From files", ...(nbId ? { notebook_id: nbId } : {}), title, body: html, created_by: user.id }).select("id").single();
    if (error) return { error: error.message };
    try { await reindexSource(supabase, spaceId, "note", data.id, title, noteText(html)); } catch { /* best-effort */ }
    revalidatePath(`/spaces/${spaceId}/notes`);
    return { id: data.id as string, title };
  } catch (e) {
    if (e instanceof Error && /readable text|can't be converted/.test(e.message)) return { error: e.message };
    return { error: friendlyError(e, "convert this file into a note") };
  }
}
