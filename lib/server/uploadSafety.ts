import "server-only";
import { callVision } from "@/lib/server/aiRoute";

// Automatic check of an uploaded picture, or of frames taken from an uploaded video (migration 43).
// Verdicts: ok (nothing found), unsafe, unsure, unavailable (the check could not run). Only "ok" lets a file go live;
// everything else leaves it pending for an admin. An unrun check is NEVER ok.

export type MediaOutcome = "ok" | "unsure" | "unsafe" | "unavailable";
export type MediaVerdict = { outcome: MediaOutcome; category: string; reason: string };

const PROMPT = `You are a strict safety check for pictures uploaded to a student study site that includes minors. Reply with JSON only: {"verdict": "safe" | "unsafe" | "unsure", "category": string, "reason": string}.
unsafe: sexual content or nudity; any child or minor in a sexual, nude or otherwise unsafe context; graphic violence or gore; self-harm; hate symbols or hateful imagery; a weapon being used to threaten someone; illegal drug use or drug sales; ID documents or other private personal information.
unsure: you cannot tell, the picture is too dark or blurry to judge, or it might be one of the above.
safe: ordinary photos, scenery, rooms, people fully clothed in normal situations, diagrams, handwriting, notes, anatomy or medical drawings in a study context, memes, cartoons.
When several pictures are given, they are frames from one video: answer unsafe or unsure if ANY frame is. Keep reason under 15 words.`;

function parse(raw: string): { verdict?: string; category?: string; reason?: string } | null {
  const m = /\{[\s\S]*\}/.exec(raw.replace(/<think>[\s\S]*?<\/think>/g, ""));
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/** At most 4 pictures per request; any unsafe wins, then unsure, then a failed batch makes the whole check unavailable. */
export async function classifyImages(urls: string[]): Promise<MediaVerdict> {
  if (!urls.length) return { outcome: "unavailable", category: "", reason: "Nothing to check" };
  let worst: MediaVerdict = { outcome: "ok", category: "", reason: "" };
  const rank = { ok: 0, unavailable: 1, unsure: 2, unsafe: 3 } as const;
  for (let i = 0; i < urls.length; i += 4) {
    let v: MediaVerdict;
    try {
      const r = await callVision({ purpose: "batch", text: PROMPT, imageDataUrls: urls.slice(i, i + 4), maxTokens: 150, json: true, task: "upload check" });
      const out = parse(r.content);
      if (!out || !out.verdict) v = { outcome: "unavailable", category: "", reason: "The check gave no answer" };
      else if (out.verdict === "safe") v = { outcome: "ok", category: "", reason: "" };
      else v = { outcome: out.verdict === "unsafe" ? "unsafe" : "unsure", category: String(out.category ?? "").slice(0, 80), reason: String(out.reason ?? "").slice(0, 160) };
    } catch {
      v = { outcome: "unavailable", category: "", reason: "The check could not run" };
    }
    if (rank[v.outcome] > rank[worst.outcome]) worst = v;
  }
  return worst;
}

/**
 * HASH MATCHING HOOK (not implemented).
 * Known child sexual abuse material can only be found by matching against hash lists kept by child-safety bodies.
 * That cannot be built in this app. To add it, wire ONE of these in here and return { match: true } on a hit:
 *   - Cloudflare CSAM Scanning Tool (put the storage origin behind Cloudflare and enable the tool; it reports to NCMEC), or
 *   - Microsoft PhotoDNA Cloud Service (apply for access, send the image bytes, check the response).
 * Until then this returns null, which means "no hash check ran". Callers must not read null as "no match found".
 */
export async function csamHashHook(_bytes: ArrayBuffer | null): Promise<{ match: boolean } | null> {
  void _bytes;
  return null;
}
