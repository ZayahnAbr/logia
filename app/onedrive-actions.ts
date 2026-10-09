"use server";

import { revalidatePath } from "next/cache";
import { authed, friendlyError } from "@/lib/server/llm";
import { notebookIdForName } from "@/lib/server/notebooks";
import { reindexSource, noteText } from "@/lib/server/rag";
import { fileToNoteHtml } from "@/lib/server/fileToNote";
import { cleanBlocks, trimTrailing } from "@/lib/gdocBlocks";
import { blocksToDocx } from "@/lib/server/wordExport";
import {
  MsError, downloadFile, existingFile, listWordFiles, msAccessToken, msConfigured, uploadWord,
  type DriveFile,
} from "@/lib/server/onedrive";

export type OneDriveFail = { error: string; code?: "setup" | "connect" | "reconnect" };
const fail = (e: unknown, what: string): OneDriveFail => {
  if (e instanceof MsError) return { error: e.message, code: e.kind === "not_configured" ? "setup" : e.kind === "not_connected" ? "connect" : e.kind === "reconnect" ? "reconnect" : undefined };
  return { error: friendlyError(e, what) };
};

export type OneDriveStatus = { configured: boolean; connected: boolean };

export async function onedriveStatus(): Promise<OneDriveStatus> {
  try {
    const { supabase } = await authed();
    const { data } = await supabase.rpc("oauth_token_status", { p_provider: "microsoft" });
    return { configured: msConfigured(), connected: Array.isArray(data) ? data.length > 0 : !!data };
  } catch { return { configured: false, connected: false }; }
}

export async function onedriveDisconnect(): Promise<{ error?: string }> {
  try {
    const { supabase } = await authed();
    const { error } = await supabase.rpc("delete_oauth_token", { p_provider: "microsoft" });
    return error ? { error: "Couldn't disconnect. Try again." } : {};
  } catch { return { error: "Couldn't disconnect. Try again." }; }
}

export async function onedriveFiles(query: string): Promise<{ files: DriveFile[] } | OneDriveFail> {
  try {
    const { supabase, user } = await authed();
    const token = await msAccessToken(supabase, user.id);
    return { files: await listWordFiles(token, query) };
  } catch (e) { return fail(e, "list your Word files"); }
}

export type ImportedNote = { id: string; title: string; body: string; folder: string; notebook_id: string | null };

async function noteFromDocx(spaceId: string, name: string, buf: Buffer): Promise<ImportedNote | { error: string }> {
  const { supabase, user } = await authed();
  if (buf.length > 25 * 1024 * 1024) return { error: "That file is over the 25 MB limit." };
  let html: string;
  try { html = (await fileToNoteHtml(name, buf)).slice(0, 1_900_000); }
  catch (e) {
    if (e instanceof Error && /readable text|can't be converted/.test(e.message)) return { error: e.message };
    return { error: "Logia couldn't read that Word file. It may be damaged or password protected." };
  }
  const title = name.replace(/\.[^.]+$/, "").slice(0, 120) || "Imported note";
  const folder = "From Word";
  const nbId = await notebookIdForName(supabase, spaceId, user.id, folder);
  const { data, error } = await supabase.from("notes")
    .insert({ space_id: spaceId, folder, ...(nbId ? { notebook_id: nbId } : {}), title, body: html, created_by: user.id }).select("id").single();
  if (error) return { error: error.message };
  try { await reindexSource(supabase, spaceId, "note", data.id, title, noteText(html)); } catch { /* best-effort */ }
  revalidatePath(`/spaces/${spaceId}/notes`);
  return { id: data.id as string, title, body: html, folder, notebook_id: nbId ?? null };
}

/** Pictures and tables in the Word file are not brought in; text, headings, lists and simple formatting are. */
export async function importWordFromOneDrive(spaceId: string, itemId: string): Promise<ImportedNote | OneDriveFail> {
  try {
    const { supabase, user } = await authed();
    const token = await msAccessToken(supabase, user.id);
    const { buffer, name } = await downloadFile(token, itemId);
    return await noteFromDocx(spaceId, name, buffer);
  } catch (e) { return fail(e, "import that Word file"); }
}

export async function importWordUpload(spaceId: string, form: FormData): Promise<ImportedNote | { error: string }> {
  try {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose a Word (.docx) file." };
    if (!/\.docx$/i.test(file.name)) return { error: "Only Word (.docx) files can be imported here." };
    return await noteFromDocx(spaceId, file.name, Buffer.from(await file.arrayBuffer()));
  } catch (e) { return { error: friendlyError(e, "import that Word file") }; }
}

const safeFileName = (t: string) => (t.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 100) || "Untitled note") + ".docx";

/**
 * Saves the note to OneDrive as a Word file in the "Logia" folder. If a file with that name is already there, nothing
 * is changed until the caller confirms with replace = true. Edits made in Word are never brought back.
 */
export async function saveNoteToOneDrive(title: string, blocks: unknown, replace: boolean): Promise<{ state: "saved"; file: DriveFile } | { state: "exists"; file: DriveFile } | OneDriveFail> {
  try {
    const { supabase, user } = await authed();
    const clean = cleanBlocks(blocks);
    if (!clean) return { error: "This note is too large to save as a Word file." };
    const token = await msAccessToken(supabase, user.id);
    const name = safeFileName(title);
    if (!replace) {
      const there = await existingFile(token, name);
      if (there) return { state: "exists", file: there };
    }
    const buf = await blocksToDocx(title, trimTrailing(clean));
    return { state: "saved", file: await uploadWord(token, name, buf, replace) };
  } catch (e) { return fail(e, "save to OneDrive"); }
}
