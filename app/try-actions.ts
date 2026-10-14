"use server";

// The landing-page "try it" tool: a signed-out visitor drops in a file or pastes text and gets notes,
// flashcards or a transcript back — nothing is saved, no account or space is created. Deliberately
// self-contained and separate from the real student-facing AI pipeline (lib/server/aiRoute.ts): it
// never touches profiles, llm_usage or the shared provider pool, so it carries zero risk to any of
// that, and the small, IP-based rate limit below (migration 52) is the only thing standing between
// this and an open door to the AI bill. Keep the cap low.

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { hasBlockedWord } from "@/lib/moderation";
import { blocksToDocx } from "@/lib/server/wordExport";
import type { Block } from "@/lib/gdocBlocks";

const MISSING = "This isn't switched on yet. Run supabase/migration-52-try-logia.sql in Supabase first.";
const TRY_AGAIN_LATER = "You've used today's free tries on this connection. Sign up free to keep going.";
const MAX_TEXT = 40_000; // characters — generous for a few pages, short of anything costly
const MIN_TEXT = 60;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

async function ipHash(): Promise<string> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "unknown").trim();
  // Never store the address itself — only a one-way hash, just enough to count attempts per connection.
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

async function trialAllowed(kind: "generate" | "transcribe"): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const hash = await ipHash();
  const { data, error } = await supabase.rpc("anon_trial_try", { p_ip_hash: hash, p_kind: kind, p_max: 3, p_window_hours: 24 });
  if (error) return { error: /does not exist|schema cache|could not find/i.test(error.message) ? MISSING : "Couldn't check that. Please try again." };
  return data ? { ok: true } : { error: TRY_AGAIN_LATER };
}

// A direct, minimal Groq call — intentionally not lib/server/aiRoute.ts's callChat/callAudio, which
// assume a real signed-in student for pacing and usage logging. One provider, no retry pool: if Groq
// is briefly down, the visitor sees "try again in a moment" rather than this feature silently drawing
// on the same capacity real students are using.
async function groqJson(system: string, user: string, maxTokens: number): Promise<Record<string, unknown>> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Logia's demo isn't fully set up yet (missing GROQ_API_KEY).");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b", temperature: 0.3, max_tokens: maxTokens,
      response_format: { type: "json_object" }, reasoning_effort: "low",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(res.status === 429 ? "Busy right now. Please try again in a minute." : "Couldn't generate that right now.");
  const data = await res.json();
  const content: string = data.choices?.[0]?.message?.content ?? "{}";
  try { return JSON.parse(content); }
  catch { const m = content.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } } throw new Error("Couldn't read that answer. Please try again."); }
}

export type TryNotes = { kind: "notes"; title: string; html: string };
export type TryFlashcards = { kind: "flashcards"; cards: { question: string; answer: string }[] };
export type TryResult = TryNotes | TryFlashcards;

const SYSTEMS = {
  notes: `You turn a student's material into clear study notes. Use short headings, bullet points and **bold** for key terms. Stay focused on what's actually in the material — never invent facts. Keep it skimmable, not a full rewrite.
Reply with ONLY a JSON object: {"title": "a short title for these notes", "html": "the notes as simple HTML using only <h3>, <p>, <ul>, <li> and <strong> tags"}.`,
  flashcards: `You turn a student's material into flashcards. Make 6 to 10 cards, each testing one clear idea from the material — never invent facts not in it. Questions should be specific, answers concise.
Reply with ONLY a JSON object: {"cards": [{"question": "...", "answer": "..."}]}.`,
} as const;

export async function tryGenerateFromText(input: { text: string; action: "notes" | "flashcards" }): Promise<TryResult | { error: string }> {
  const text = input.text.trim().slice(0, MAX_TEXT);
  if (text.length < MIN_TEXT) return { error: "That's a bit short to work with. Paste in a bit more, or try a different file." };
  if (hasBlockedWord(text)) return { error: "That content can't be used here." };
  const allowed = await trialAllowed("generate");
  if ("error" in allowed) return allowed;
  try {
    const out = await groqJson(SYSTEMS[input.action], text, input.action === "flashcards" ? 1400 : 1000);
    if (input.action === "notes") {
      const title = String(out.title ?? "Your notes").slice(0, 120);
      const html = String(out.html ?? "").slice(0, 8000);
      if (!html) return { error: "Couldn't make notes from that. Please try again." };
      return { kind: "notes", title, html };
    }
    const cards = (Array.isArray(out.cards) ? out.cards : [])
      .map((c: unknown) => { const r = c as { question?: unknown; answer?: unknown } | null; return { question: String(r?.question ?? "").slice(0, 300), answer: String(r?.answer ?? "").slice(0, 500) }; })
      .filter((c: { question: string; answer: string }) => c.question && c.answer)
      .slice(0, 12);
    if (!cards.length) return { error: "Couldn't make flashcards from that. Please try again." };
    return { kind: "flashcards", cards };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't generate that. Please try again." };
  }
}

// A .docx copy of a trial result, for someone who wants the file without creating an account.
// Reuses the same docx builder the real (signed-in) note export uses, but skips its auth check —
// there's no note row to own here, just blocks built from whatever the visitor already has on screen.
export async function tryExportDocx(title: string, blocks: Block[]): Promise<{ base64: string; filename: string } | { error: string }> {
  if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > 500) return { error: "Couldn't make that file. Please try again." };
  try {
    const buf = await blocksToDocx((title ?? "").slice(0, 200), blocks);
    const name = (title ?? "").replace(/[^\w\- ]+/g, "").trim().slice(0, 80) || "logia";
    return { base64: buf.toString("base64"), filename: `${name}.docx` };
  } catch {
    return { error: "Couldn't make the file. Please try again." };
  }
}

export async function tryTranscribeAudio(input: { base64: string; mime: string; filename: string }): Promise<{ transcript: string } | { error: string }> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { error: "Logia's demo isn't fully set up yet (missing GROQ_API_KEY)." };
  const bytes = Buffer.from(input.base64, "base64");
  if (bytes.length === 0) return { error: "That file looks empty." };
  if (bytes.length > MAX_AUDIO_BYTES) return { error: "That file is over 15 MB. Try a shorter clip for the demo." };
  const allowed = await trialAllowed("transcribe");
  if ("error" in allowed) return allowed;
  try {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: input.mime || "audio/mpeg" }), input.filename || "audio");
    form.append("model", "whisper-large-v3-turbo");
    form.append("response_format", "text");
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form,
    });
    if (!res.ok) return { error: res.status === 429 ? "Busy right now. Please try again in a minute." : "Couldn't transcribe that. Try a clearer recording." };
    const transcript = (await res.text()).trim();
    if (!transcript) return { error: "Couldn't hear anything to transcribe in that file." };
    return { transcript: transcript.slice(0, 20_000) };
  } catch {
    return { error: "Couldn't reach the transcription service. Please try again." };
  }
}
