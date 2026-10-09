"use server";

import { createClient } from "@/lib/supabase/server";
import { classifyImages, csamHashHook, type MediaVerdict } from "@/lib/server/uploadSafety";

// Checks run here, never in the browser. The database decides what is visible (migration 43): a file is hidden from
// everyone but the uploader until set_media_verdict() marks it clean, and that needs MODERATION_SECRET.

const BUCKETS = ["cafe-media", "space-widgets", "space-headers", "notebook-covers"];
const MISSING = "Uploads need a database update. Run supabase/migration-43-upload-safety.sql.";
const FRAME_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const INLINE_BYTES = 3 * 1024 * 1024;

export type UploadState = "clean" | "pending" | "unsafe";

/** Plain-language yes or no before an upload or hosting starts. The database enforces the same rules. */
export async function preflightUpload(kind: "image" | "video" | "host"): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };
  const { data, error } = kind === "host" ? await supabase.rpc("host_block_reason") : await supabase.rpc("upload_block_reason", { p_kind: kind });
  if (error) return { ok: true }; // before migration 43 there is no rule to apply
  return typeof data === "string" && data ? { error: data } : { ok: true };
}

export async function reviewUpload(input: { bucket: string; path: string; kind: "image" | "video"; frames?: string[] }): Promise<{ state: UploadState } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };
  if (!BUCKETS.includes(input.bucket) || !input.path || input.path.includes("..")) return { error: "That file could not be checked." };

  let verdict: MediaVerdict = { outcome: "unavailable", category: "", reason: "The check could not run" };
  let frames: string[] | null = null;
  try {
    if (input.kind === "video") {
      const f = (input.frames ?? []).filter((x) => typeof x === "string" && x.length < 220_000 && FRAME_RE.test(x)).slice(0, 8);
      if (f.length < 6) verdict = { outcome: "unavailable", category: "", reason: "Not enough frames to check the video" };
      else { frames = f; verdict = await classifyImages(f); }
    } else {
      const dl = await supabase.storage.from(input.bucket).download(input.path);
      if (dl.error || !dl.data || dl.data.size > MAX_IMAGE_BYTES) verdict = { outcome: "unavailable", category: "", reason: "The picture could not be read" };
      else {
        const hash = await csamHashHook(await dl.data.arrayBuffer());
        if (hash?.match) verdict = { outcome: "unsafe", category: "csam hash match", reason: "Matched a known-material hash list" };
        else if (!/^image\/(jpeg|png|webp|gif)$/.test(dl.data.type)) verdict = { outcome: "unavailable", category: "", reason: "Picture type could not be checked" };
        else {
          let url: string | undefined;
          if (dl.data.size <= INLINE_BYTES) url = `data:${dl.data.type};base64,${Buffer.from(await dl.data.arrayBuffer()).toString("base64")}`;
          else url = (await supabase.storage.from(input.bucket).createSignedUrl(input.path, 300)).data?.signedUrl;
          verdict = url ? await classifyImages([url]) : { outcome: "unavailable", category: "", reason: "The picture could not be read" };
        }
      }
    }
  } catch {
    verdict = { outcome: "unavailable", category: "", reason: "The check could not run" };
  }

  const { data, error } = await supabase.rpc("set_media_verdict", {
    p_bucket: input.bucket, p_path: input.path, p_outcome: verdict.outcome, p_category: verdict.category, p_reason: verdict.reason,
    p_frames: frames, p_secret: process.env.MODERATION_SECRET ?? null,
  });
  if (error) {
    if (/does not exist|schema cache|could not find/i.test(error.message)) return { error: MISSING };
    // The check could not be recorded (for example the moderation secret does not match). The upload still works for
    // the student; the database keeps it hidden from everyone else until it is reviewed, so nothing unsafe leaks.
    console.warn("[upload-safety] set_media_verdict failed:", error.message);
    return { state: "pending" };
  }
  if (data === "clean") return { state: "clean" };
  return { state: verdict.outcome === "unsafe" ? "unsafe" : "pending" };
}

/** Which of these files can others see yet? Used to hold back hosted rooms. */
export async function mediaStates(bucket: string, paths: string[]): Promise<Record<string, "clean" | "pending" | "unsafe" | "removed">> {
  const supabase = await createClient();
  const list = paths.filter(Boolean).slice(0, 100);
  if (!list.length) return {};
  const { data, error } = await supabase.rpc("media_states", { p_bucket: bucket, p_paths: list });
  if (error) return {};
  return Object.fromEntries(((data ?? []) as { path: string; state: "clean" | "pending" | "unsafe" | "removed" }[]).map((r) => [r.path, r.state]));
}
