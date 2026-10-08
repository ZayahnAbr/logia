import "server-only";
import type { createClient } from "@/lib/supabase/server";

// Retrieval for Ask AI: one ranked search, then each hit is widened with its neighbouring
// chunks so the model sees whole explanations, capped to a fixed context budget.
type Supa = Awaited<ReturnType<typeof createClient>>;
export type Passage = { id: string; source_type: string; source_id: string; source_title: string; chunk_index: number; content: string; rank: number };

const STOP = new Set("what with from this that does have about were they your when which will into than then also been more some such explain tell describe give define difference between how why who where can could would should please".split(" "));

export function keywordsOf(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
}

async function search(supabase: Supa, spaceId: string, query: string, limit: number): Promise<Passage[]> {
  const { data, error } = await supabase.rpc("search_space", { p_space_id: spaceId, p_query: query, p_limit: limit });
  if (!error) return (data ?? []) as Passage[];
  // Migration 19 not run yet: fall back to the older search function.
  const old = await supabase.rpc("search_chunks", { p_space_id: spaceId, p_query: query, p_limit: limit });
  return ((old.data ?? []) as Passage[]).map((p) => ({ ...p, rank: p.rank ?? 0 }));
}

export async function retrieve(supabase: Supa, spaceId: string, question: string, previousQuestion?: string) {
  // Follow-ups ("and the second one?") inherit the previous question's topic.
  const short = keywordsOf(question).length < 3 && previousQuestion;
  const query = short ? `${question} ${previousQuestion}` : question;

  let hits = await search(supabase, spaceId, query, 8);
  if (!hits.length && short) hits = await search(supabase, spaceId, question, 8);
  if (!hits.length) {
    // Last resort: any chunk containing the rarest-looking keyword.
    const kw = keywordsOf(query).sort((a, b) => b.length - a.length)[0];
    if (kw) {
      const { data } = await supabase.from("content_chunks").select("id, source_type, source_id, source_title, chunk_index, content")
        .eq("space_id", spaceId).ilike("content", `%${kw}%`).limit(6);
      hits = ((data ?? []) as Passage[]).map((p) => ({ ...p, rank: 0.01 }));
    }
  }
  if (!hits.length) return [];

  // Keep the best hits, at most 3 per source so one long document can't crowd out the rest.
  const perSource = new Map<string, number>();
  const top = hits.sort((a, b) => b.rank - a.rank).filter((h) => {
    const n = perSource.get(h.source_id) ?? 0;
    if (n >= 3) return false;
    perSource.set(h.source_id, n + 1);
    return true;
  }).slice(0, 6);

  // Widen each hit with the chunk before and after it (same source), then merge runs.
  const wanted = top.flatMap((h) => [h.chunk_index - 1, h.chunk_index, h.chunk_index + 1].map((i) => `${h.source_id}:${i}`));
  const bySource = [...new Set(top.map((h) => h.source_id))];
  const { data: around } = await supabase.from("content_chunks").select("source_id, chunk_index, content")
    .eq("space_id", spaceId).in("source_id", bySource)
    .in("chunk_index", [...new Set(top.flatMap((h) => [h.chunk_index - 1, h.chunk_index, h.chunk_index + 1]))]);
  const text = new Map(((around ?? []) as { source_id: string; chunk_index: number; content: string }[]).map((r) => [`${r.source_id}:${r.chunk_index}`, r.content]));

  const BUDGET = 5000;
  let used = 0;
  const passages: (Passage & { context: string })[] = [];
  for (const h of top) {
    const ctx = [h.chunk_index - 1, h.chunk_index, h.chunk_index + 1]
      .map((i) => (wanted.includes(`${h.source_id}:${i}`) ? text.get(`${h.source_id}:${i}`) : undefined) ?? (i === h.chunk_index ? h.content : ""))
      .filter(Boolean).join(" ");
    const clipped = ctx.slice(0, Math.max(400, BUDGET - used));
    if (used >= BUDGET) break;
    used += clipped.length;
    passages.push({ ...h, context: clipped });
  }
  return passages;
}

// Plain text of a note body for indexing (handles HTML and handwritten pages).
export function noteText(body: string) {
  let src = body ?? "";
  if (src.startsWith("<!--ink:")) { try { src = JSON.parse(src.slice(8, src.lastIndexOf("-->"))).text ?? ""; } catch { src = ""; } }
  return src.replace(/<\/(p|h[1-6]|li|div)>/g, "\n").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").trim();
}

export function chunk(text: string, target = 900): string[] {
  if (!text) return [];
  const sentences = text.match(/[^.!?\n]+[.!?\n]+["”)]?\s*/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur.length + s.length > target && cur) { out.push(cur.trim()); cur = ""; }
    cur += s;
  }
  if (cur.trim().length > 20) out.push(cur.trim());
  return out;
}

/** Replace a source's chunks with fresh ones (called whenever a note/lecture changes). */
export async function reindexSource(supabase: Supa, spaceId: string, sourceType: "note" | "lecture" | "file", sourceId: string, title: string, text: string) {
  await supabase.from("content_chunks").delete().eq("source_id", sourceId);
  const pieces = chunk(text);
  if (!pieces.length) return;
  await supabase.from("content_chunks").insert(pieces.map((content, i) => ({ space_id: spaceId, source_type: sourceType, source_id: sourceId, source_title: title || "Untitled", chunk_index: i, content })));
}
