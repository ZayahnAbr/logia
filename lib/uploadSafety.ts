import { preflightUpload, reviewUpload } from "@/app/upload-safety-actions";
import { extractFrames } from "@/lib/videoFrames";

// Browser helpers around the server-side check. The database is what enforces the result; this only asks and explains.

export const PENDING_NOTE = "Being checked. Only you can see it until then.";
export const unsafeNote = (kind: "image" | "video") => (kind === "video" ? "This video can't be used here." : "This picture can't be used here.");

/** Returns a plain message when the upload is not allowed right now, otherwise null. */
export async function uploadBlocked(kind: "image" | "video" | "host"): Promise<string | null> {
  const r = await preflightUpload(kind);
  return "error" in r ? r.error : null;
}

/** Run after the file is in storage. state "clean" means normal use; anything else is held for the uploader only. */
export async function checkUploaded(bucket: string, path: string, kind: "image" | "video", file?: Blob): Promise<{ state: "clean" | "pending" | "unsafe"; message: string | null }> {
  const frames = kind === "video" && file ? await extractFrames(file) : undefined;
  let r: Awaited<ReturnType<typeof reviewUpload>>;
  try { r = await reviewUpload({ bucket, path, kind, frames }); } catch { return { state: "pending", message: PENDING_NOTE }; }
  if ("error" in r) return { state: "pending", message: r.error };
  if (r.state === "clean") return { state: "clean", message: null };
  return { state: r.state, message: r.state === "unsafe" ? unsafeNote(kind) : PENDING_NOTE };
}
