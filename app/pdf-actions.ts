"use server";

import { authed, enforceRateLimit, friendlyError, isUnmetered } from "@/lib/server/llm";
import { callChat } from "@/lib/server/aiRoute";
import type { Plan } from "@/lib/server/plans";

interface Chunk {
  theme: string;
  keySentence: string;
  sentences: string[];
}

const SKIP_PATTERNS = /^(references?|bibliography|acknowledg|author contributions?|additional information|disclosures?|conflicts? of interest|appendix|supplementary|funding)/i;

function norm(s: string) {
  return s.toLowerCase()
    .replace(/\[[\d,\s\-–]+\]/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function existsInSource(sentence: string, sourceNorm: string): boolean {
  const n = norm(sentence);
  if (n.length < 8) return false;
  if (sourceNorm.includes(n)) return true;
  const words = n.split(" ").filter((w) => w.length > 2);
  if (words.length < 4) return false;
  return sourceNorm.includes(words.slice(0, 8).join(" "));
}

function isRealSentence(s: string): boolean {
  const t = s.trim();
  if (t.split(/\s+/).length < 7) return false;
  if (!/^[A-Z""(]/.test(t)) return false;
  if (!/[.!?][""]?$/.test(t)) return false;
  return true;
}

function splitBySentences(text: string, maxLen: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+[""]?\s*/g) ?? [text];
  const pieces: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur.length + s.length > maxLen && cur) { pieces.push(cur.trim()); cur = ""; }
    cur += s;
  }
  if (cur.trim()) pieces.push(cur.trim());
  return pieces;
}

const SYSTEM = `You are an EXTRACTIVE text organiser. You NEVER write new sentences. You only select and group COMPLETE sentences that already exist in the provided text.

Return ONLY valid JSON:
{ "chunks": [ { "theme": "2-4 word label", "keySentence": "one exact COMPLETE sentence copied verbatim", "sentences": ["exact sentence 1", "exact sentence 2"] } ] }

STRICT RULES:
- Copy sentences WORD-FOR-WORD, from capital letter to full stop. Never output a fragment or half a sentence.
- Group into 2-5 themed chunks covering the sentences that carry real facts, findings or claims.
- "theme" is the ONLY field where you may use your own words.
- No preamble, no markdown, JSON object only.`;

export async function chunkText(
  sourceText: string,
  heading?: string
): Promise<{ chunks: Chunk[]; flagged: number; coveragePct: number; skipped?: boolean } | { error: string }> {
  if (!sourceText || sourceText.length < 150) return { chunks: [], flagged: 0, coveragePct: 0 };
  if (heading && SKIP_PATTERNS.test(heading.trim())) {
    return { chunks: [], flagged: 0, coveragePct: 0, skipped: true };
  }

  let ctx: Awaited<ReturnType<typeof authed>>;
  let plan: Plan = "free";
  try { ctx = await authed(); plan = (await enforceRateLimit(ctx.supabase, ctx.user)) ?? "free"; }
  catch (e) { return { error: friendlyError(e, "build this mind map") }; }

  const pieces = splitBySentences(sourceText, 5000);
  const sourceNorm = norm(sourceText);
  const allChunks: Chunk[] = [];
  let flagged = 0;
  let failures = 0;

  for (const piece of pieces) {
    try {
      const { content } = await callChat({ purpose: "batch", system: SYSTEM, user: piece, maxTokens: 3000, temperature: 0, json: true, supabase: ctx.supabase, userId: ctx.user.id, unmetered: isUnmetered(ctx.user.email), plan });
      let parsed: any;
      try { parsed = JSON.parse(content || "{}"); }
      catch { failures++; continue; }

      for (const c of parsed.chunks ?? []) {
        const verified = (c.sentences ?? []).filter((s: string) => {
          if (!isRealSentence(s)) { flagged++; return false; }
          const ok = existsInSource(s, sourceNorm);
          if (!ok) flagged++;
          return ok;
        });
        if (verified.length === 0) continue;
        const keyOk = isRealSentence(c.keySentence ?? "") && existsInSource(c.keySentence ?? "", sourceNorm);
        if (!keyOk) flagged++;
        allChunks.push({
          theme: String(c.theme ?? "").slice(0, 60),
          keySentence: keyOk ? c.keySentence : verified[0],
          sentences: verified,
        });
      }
    } catch { failures++; }
  }

  if (allChunks.length === 0) {
    return { error: failures > 0 ? "Extraction failed for this section." : "No complete sentences found here." };
  }

  const covered = allChunks.reduce((sum, c) => sum + c.sentences.join(" ").length, 0);
  return { chunks: allChunks, flagged, coveragePct: Math.min(100, Math.round((covered / sourceText.length) * 100)) };
}
