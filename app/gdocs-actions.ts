"use server";

import { authed, friendlyError } from "@/lib/server/llm";
import {
  GdocsError, createDoc, docToBlocks, driveMeta, gdocsConfigured, getDoc, googleAccessToken, pickerConfig,
  pushBlocks, revokeGoogleToken, stripPos,
} from "@/lib/server/gdocs";
import { cleanBlocks, trimTrailing, type Block } from "@/lib/gdocBlocks";

export type GdocsFail = { error: string; code?: "setup" | "connect" | "reconnect" | "rate" | "busy" | "gone" };
const fail = (e: unknown, what: string): GdocsFail => {
  if (e instanceof GdocsError) {
    const code = e.kind === "not_configured" ? "setup" : e.kind === "not_connected" ? "connect" : e.kind === "reconnect" ? "reconnect"
      : e.kind === "rate" ? "rate" : e.kind === "busy" ? "busy" : e.kind === "not_found" ? "gone" : undefined;
    return { error: e.message, code };
  }
  return { error: friendlyError(e, what) };
};

export type GdocsStatus = { configured: boolean; connected: boolean; hasGoogle: boolean; picker: { apiKey: string; appId: string } | null };

export async function gdocsStatus(): Promise<GdocsStatus> {
  try {
    const { supabase, user } = await authed();
    const { data } = await supabase.rpc("oauth_token_status", { p_provider: "google" });
    const connected = Array.isArray(data) ? data.length > 0 : !!data;
    return { configured: gdocsConfigured(), connected, hasGoogle: !!user.identities?.some((i) => i.provider === "google"), picker: pickerConfig() };
  } catch { return { configured: false, connected: false, hasGoogle: false, picker: null }; }
}

export async function gdocsDisconnect(): Promise<{ error?: string }> {
  try {
    const { supabase } = await authed();
    await revokeGoogleToken(supabase);
    return {};
  } catch (e) { return { error: fail(e, "disconnect Google Docs").error }; }
}

/** A short-lived Google access token for the Google Picker only. The long-lived token never leaves the server. */
export async function gdocsPickerToken(): Promise<{ token: string } | GdocsFail> {
  try {
    const { supabase, user } = await authed();
    return { token: await googleAccessToken(supabase, user.id) };
  } catch (e) { return fail(e, "open the Google Docs picker"); }
}

export type NoteLink = { docId: string; title: string; status: "synced" | "conflict" | "error"; url: string };

export async function gdocsNoteLink(noteId: string): Promise<{ link: NoteLink | null }> {
  try {
    const { supabase } = await authed();
    const { data } = await supabase.from("note_doc_links").select("doc_id, doc_title, status").eq("note_id", noteId).maybeSingle();
    if (!data) return { link: null };
    return { link: { docId: data.doc_id, title: data.doc_title ?? "Google Doc", status: data.status, url: `https://docs.google.com/document/d/${data.doc_id}/edit` } };
  } catch { return { link: null }; }
}

/** Looks at a picked document before linking, so the person can choose which side to keep if both have text. */
export async function gdocsPeek(docId: string): Promise<{ title: string; blocks: number } | GdocsFail> {
  try {
    const { supabase, user } = await authed();
    const token = await googleAccessToken(supabase, user.id);
    const meta = await driveMeta(token, docId);
    const layout = docToBlocks(await getDoc(token, docId));
    return { title: meta.name, blocks: trimTrailing(stripPos(layout.blocks)).length };
  } catch (e) { return fail(e, "open that document"); }
}

const MAX_HTML = 2_000_000;

/**
 * Links a note to an existing document.
 * mode "doc": the note takes the document's text (the note's old text is saved as a copy first).
 * mode "note": the document takes the note's text (Google keeps the document's own version history).
 */
export async function gdocsLink(noteId: string, docId: string, mode: "doc" | "note", noteBlocks: unknown, backupHtml?: string): Promise<{ title: string; blocks: Block[]; backedUp?: string } | GdocsFail> {
  try {
    const { supabase, user } = await authed();
    const token = await googleAccessToken(supabase, user.id);
    const meta = await driveMeta(token, docId);
    if (meta.trashed) return { error: "That document is in the bin.", code: "gone" };
    let blocks: Block[];
    let backedUp: string | undefined;
    if (mode === "doc") {
      blocks = trimTrailing(stripPos(docToBlocks(await getDoc(token, docId)).blocks));
      if (backupHtml && backupHtml.replace(/<[^>]+>/g, "").trim() && backupHtml.length <= MAX_HTML) {
        const { data: n } = await supabase.from("notes").select("space_id, folder, notebook_id, title").eq("id", noteId).maybeSingle();
        if (n) {
          backedUp = `${(n.title || "Untitled note").slice(0, 100)} (before linking)`;
          const { error } = await supabase.from("notes").insert({ space_id: n.space_id, folder: n.folder, ...(n.notebook_id ? { notebook_id: n.notebook_id } : {}), title: backedUp, body: backupHtml, created_by: user.id });
          if (error) return { error: "Couldn't save a copy of your note first, so nothing was changed." };
        }
      }
    } else {
      const clean = cleanBlocks(noteBlocks);
      if (!clean) return { error: "This note is too large to send to Google Docs." };
      blocks = trimTrailing(clean);
      await pushBlocks(token, docId, blocks);
    }
    const { error } = await supabase.from("note_doc_links").upsert({
      note_id: noteId, user_id: user.id, doc_id: docId, doc_title: meta.name, snapshot: blocks, last_synced_revision: null, status: "synced", updated_at: new Date().toISOString(),
    });
    if (error) return { error: "Couldn't save the link. Has migration 45 been run?" };
    return { title: meta.name, blocks, backedUp };
  } catch (e) { return fail(e, "link that document"); }
}

export async function gdocsCreate(noteId: string, title: string, noteBlocks: unknown): Promise<{ docId: string; url: string; title: string } | GdocsFail> {
  try {
    const { supabase, user } = await authed();
    const clean = cleanBlocks(noteBlocks);
    if (!clean) return { error: "This note is too large to send to Google Docs." };
    const token = await googleAccessToken(supabase, user.id);
    const name = title.trim().slice(0, 200) || "Untitled note";
    const doc = await createDoc(token, name);
    const blocks = trimTrailing(clean);
    await pushBlocks(token, doc.id, blocks);
    const { error } = await supabase.from("note_doc_links").upsert({
      note_id: noteId, user_id: user.id, doc_id: doc.id, doc_title: name, snapshot: blocks, last_synced_revision: null, status: "synced", updated_at: new Date().toISOString(),
    });
    if (error) return { error: "The document was created, but Logia couldn't save the link. Has migration 45 been run?" };
    return { docId: doc.id, url: doc.link, title: name };
  } catch (e) { return fail(e, "create a Google Doc"); }
}

export async function gdocsUnlink(noteId: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await authed();
    const { error } = await supabase.from("note_doc_links").delete().eq("note_id", noteId);
    return error ? { error: "Couldn't unlink. Try again." } : {};
  } catch (e) { return { error: fail(e, "unlink").error }; }
}

export type PullResult =
  | { state: "unchanged"; base: Block[]; revision: string }
  | { state: "changed"; base: Block[]; remote: Block[]; revision: string };

/** Checks the Drive file's version (cheap). Fetches and converts the document only when it changed since the last sync. */
export async function gdocsPull(noteId: string, force = false): Promise<PullResult | GdocsFail> {
  try {
    const { supabase, user } = await authed();
    const { data: link } = await supabase.from("note_doc_links").select("doc_id, snapshot, last_synced_revision").eq("note_id", noteId).maybeSingle();
    if (!link) return { error: "This note isn't linked to a Google Doc.", code: "gone" };
    const token = await googleAccessToken(supabase, user.id);
    const meta = await driveMeta(token, link.doc_id);
    if (meta.trashed) return { error: "The linked Google Doc is in the bin.", code: "gone" };
    const base = (cleanBlocks(link.snapshot) ?? []) as Block[];
    if (!force && link.last_synced_revision && link.last_synced_revision === meta.version) return { state: "unchanged", base, revision: meta.version };
    const remote = trimTrailing(stripPos(docToBlocks(await getDoc(token, link.doc_id)).blocks));
    return { state: "changed", base, remote, revision: meta.version };
  } catch (e) { return fail(e, "check the Google Doc"); }
}

/**
 * Finishes a sync round. `desired` is the text to send to the document (null to send nothing, for example while a
 * "Changed in both places" choice is waiting). `base` is what both sides now agree on.
 */
export async function gdocsPush(noteId: string, input: { desired: unknown | null; base: unknown; revision: string | null; status: "synced" | "conflict" }): Promise<{ pushed: boolean } | GdocsFail> {
  try {
    const { supabase, user } = await authed();
    const base = cleanBlocks(input.base);
    const desired = input.desired === null ? null : cleanBlocks(input.desired);
    if (!base || (input.desired !== null && !desired)) return { error: "This note is too large to sync with Google Docs." };
    const { data: link } = await supabase.from("note_doc_links").select("doc_id").eq("note_id", noteId).maybeSingle();
    if (!link) return { error: "This note isn't linked to a Google Doc.", code: "gone" };
    let pushed = false;
    if (desired) {
      const token = await googleAccessToken(supabase, user.id);
      pushed = await pushBlocks(token, link.doc_id, desired);
    }
    // After sending, forget the version so the next check reads the document again; an edit made in Docs meanwhile is then picked up.
    const { error } = await supabase.from("note_doc_links").update({
      snapshot: trimTrailing(base), last_synced_revision: pushed ? null : input.revision, status: input.status, updated_at: new Date().toISOString(),
    }).eq("note_id", noteId);
    if (error) return { error: "Couldn't save the sync state." };
    return { pushed };
  } catch (e) { return fail(e, "sync with Google Docs"); }
}

export async function gdocsSetStatus(noteId: string, status: "synced" | "conflict" | "error"): Promise<void> {
  try {
    const { supabase } = await authed();
    await supabase.from("note_doc_links").update({ status, updated_at: new Date().toISOString() }).eq("note_id", noteId);
  } catch { /* best effort */ }
}
