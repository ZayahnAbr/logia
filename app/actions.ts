"use server";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { hasBlockedWord } from "@/lib/moderation";
import { nextSchedule } from "@/lib/scheduler";
import type { Card, Rating, SpaceType } from "@/lib/types";
import { notebookIdForName } from "@/lib/server/notebooks";
import { retrieve, reindexSource, noteText } from "@/lib/server/rag";
import { friendlyError, authed, enforceRateLimit, groqChat, isUnmetered } from "@/lib/server/llm";
import { callChat, callVision, callAudio } from "@/lib/server/aiRoute";
import type { Plan } from "@/lib/server/plans";


export async function createSpace(name: string, subject: string, type: SpaceType) {
  const { supabase, user } = await authed();
  if (hasBlockedWord(`${name} ${subject}`)) return { error: "That name can't be used. Please choose a different one." };
  const { error } = await supabase.from("spaces").insert({ name, subject: subject || null, type, created_by: user.id });
  if (error) return { error: error.message };
  const { data } = await supabase.from("spaces").select("id").eq("created_by", user.id).order("created_at", { ascending: false }).limit(1).single();
  revalidatePath("/spaces");
  return { id: data?.id as string };
}

export async function joinSpace(code: string) {
  const { supabase } = await authed();
  const { data, error } = await supabase.rpc("join_space_by_code", { _code: code });
  if (error) return { error: error.message };
  revalidatePath("/spaces");
  return { id: data as string };
}

export async function createDeck(spaceId: string, title: string, subject: string) {
  const { supabase, user } = await authed();
  const { error } = await supabase.from("active_recall_decks").insert({ space_id: spaceId, title, subject: subject || null, created_by: user.id, cards_json: [] });
  if (error) return { error: error.message };
  revalidatePath(`/spaces/${spaceId}`);
  return {};
}

export async function addCard(spaceId: string, deckId: string, card: { concept: string; question: string; hint: string }) {
  const { supabase } = await authed();
  const { data: deck, error: readErr } = await supabase.from("active_recall_decks").select("cards_json").eq("deck_id", deckId).single();
  if (readErr) return { error: readErr.message };
  const cards: Card[] = [...((deck.cards_json as Card[]) ?? []), { id: crypto.randomUUID(), ...card }];
  const { error } = await supabase.from("active_recall_decks").update({ cards_json: cards }).eq("deck_id", deckId);
  if (error) return { error: error.message };
  revalidatePath(`/spaces/${spaceId}/decks/${deckId}`);
  return {};
}

export async function deleteCard(spaceId: string, deckId: string, cardId: string) {
  const { supabase } = await authed();
  const { data: deck, error: readErr } = await supabase.from("active_recall_decks").select("cards_json").eq("deck_id", deckId).single();
  if (readErr) return { error: readErr.message };
  const cards = ((deck.cards_json as Card[]) ?? []).filter((c) => c.id !== cardId);
  const { error } = await supabase.from("active_recall_decks").update({ cards_json: cards }).eq("deck_id", deckId);
  if (error) return { error: error.message };
  await supabase.from("card_reviews").delete().eq("card_id", cardId);
  revalidatePath(`/spaces/${spaceId}/decks/${deckId}`);
  return {};
}

export async function rateCard(spaceId: string, deckId: string, cardId: string, rating: Rating) {
  const { supabase, user } = await authed();
  const { data: existing } = await supabase
    .from("card_reviews")
    .select("due, stability, difficulty, scheduled_days, reps, lapses, state, last_review")
    .eq("user_id", user.id).eq("card_id", cardId).maybeSingle();
  const next = nextSchedule(existing ?? null, rating);
  const { error } = await supabase.from("card_reviews").upsert({ user_id: user.id, card_id: cardId, deck_id: deckId, space_id: spaceId, ...next, updated_at: new Date().toISOString() });
  if (error) return { error: error.message };
  revalidatePath(`/spaces/${spaceId}/decks/${deckId}`);
  return {};
}

export async function logFocusSession(spaceId: string, minutes: number, retention: number | null) {
  const { supabase, user } = await authed();
  const { error } = await supabase.from("focus_analytics").insert({ user_id: user.id, space_id: spaceId, duration_minutes: minutes, retention_score: retention });
  if (error) return { error: error.message };
  revalidatePath(`/spaces/${spaceId}`);
  return {};
}

export async function uploadFile(formData: FormData) {
  const { supabase, user } = await authed();
  const spaceId = formData.get("spaceId") as string;
  const folder = ((formData.get("folder") as string) || "General").trim();
  const file = formData.get("file") as File;
  if (!file || file.size === 0) return { error: "No file selected." };
  if (file.size > 25 * 1024 * 1024) return { error: "File is over the 25 MB limit." };
  const safeName = file.name.replace(/[^\w.\-]/g, "_");
  const path = `${spaceId}/${crypto.randomUUID()}-${safeName}`;
  const { error: upErr } = await supabase.storage.from("space-files").upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return { error: upErr.message };
  const { data, error: dbErr } = await supabase.from("files").insert({ space_id: spaceId, folder, name: file.name, path, size_bytes: file.size, mime_type: file.type, uploaded_by: user.id }).select("id").single();
  if (dbErr) { await supabase.storage.from("space-files").remove([path]); return { error: dbErr.message }; }
  revalidatePath(`/spaces/${spaceId}/files`);
  return { id: data.id as string };
}

export async function deleteFile(spaceId: string, fileId: string, path: string) {
  const { supabase } = await authed();
  await supabase.storage.from("space-files").remove([path]);
  const { error } = await supabase.from("files").delete().eq("id", fileId);
  if (error) return { error: error.message };
  revalidatePath(`/spaces/${spaceId}/files`);
  return {};
}

export async function getFileUrl(path: string) {
  const { supabase } = await authed();
  const { data, error } = await supabase.storage.from("space-files").createSignedUrl(path, 60 * 60);
  if (error) return { error: error.message };
  return { url: data.signedUrl };
}

// `folder` is the notebook name ("General" = loose notes). Pass `notebookId` when you already know it.
export async function createNote(spaceId: string, folder: string, title: string, body = "", notebookId?: string | null) {
  const { supabase, user } = await authed();
  const nbId = notebookId !== undefined ? notebookId : await notebookIdForName(supabase, spaceId, user.id, folder);
  const row: Record<string, unknown> = { space_id: spaceId, folder: folder.trim().slice(0, 60) || "General", title: title.trim(), body: body.slice(0, 2_000_000), created_by: user.id };
  if (nbId) row.notebook_id = nbId;
  const { data, error } = await supabase.from("notes").insert(row).select("id").single();
  if (error) return { error: error.message };
  revalidatePath(`/spaces/${spaceId}/notes`);
  return { id: data?.id as string };
}

// `folder` is optional: leave it out to keep the note in its notebook (autosave does this).
export async function updateNote(spaceId: string, noteId: string, title: string, body: string, folder?: string) {
  const { supabase, user } = await authed();
  const patch: Record<string, unknown> = { title: title.trim(), body, updated_at: new Date().toISOString() };
  if (folder !== undefined) {
    patch.folder = folder.trim().slice(0, 60) || "General";
    patch.notebook_id = await notebookIdForName(supabase, spaceId, user.id, folder);
  }
  const { error } = await supabase.from("notes").update(patch).eq("id", noteId);
  if (error) return { error: error.message };
  try { await reindexSource(supabase, spaceId, "note", noteId, title.trim(), noteText(body)); } catch { /* search index is best-effort */ }
  revalidatePath(`/spaces/${spaceId}/notes`);
  return {};
}

export async function deleteNote(spaceId: string, noteId: string) {
  const { supabase } = await authed();
  await supabase.from("content_chunks").delete().eq("source_id", noteId);
  const { error } = await supabase.from("notes").delete().eq("id", noteId);
  if (error) return { error: error.message };
  revalidatePath(`/spaces/${spaceId}/notes`);
  return {};
}

export async function createLecture(formData: FormData) {
  const { supabase, user } = await authed();
  const spaceId = formData.get("spaceId") as string;
  const title = ((formData.get("title") as string) || "Untitled lecture").trim();
  const file = formData.get("file") as File;
  if (!file || file.size === 0) return { error: "No audio file selected." };
  if (file.size > 25 * 1024 * 1024) return { error: "Audio is over the 25 MB free-tier limit." };
  const safeName = file.name.replace(/[^\w.\-]/g, "_");
  const path = `${spaceId}/audio-${crypto.randomUUID()}-${safeName}`;
  const { error: upErr } = await supabase.storage.from("space-files").upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return { error: upErr.message };
  const { data, error: dbErr } = await supabase.from("lectures_audio").insert({ space_id: spaceId, title, audio_path: path, status: "uploaded", created_by: user.id }).select("id").single();
  if (dbErr) { await supabase.storage.from("space-files").remove([path]); return { error: dbErr.message }; }
  revalidatePath(`/spaces/${spaceId}/lectures`);
  return { id: data?.id as string };
}

export async function transcribeLecture(spaceId: string, lectureId: string, audioPath: string) {
  const { supabase, user } = await authed();
  // Audio length is unknown here, so reserve a typical lecture's worth up front.
  let plan: Plan | undefined;
  try { plan = await enforceRateLimit(supabase, user, { purpose: "batch", estimate: 6000, task: "transcribe a lecture" }); } catch (e) { return { error: friendlyError(e, "transcribe this lecture") }; }
  await supabase.from("lectures_audio").update({ status: "transcribing" }).eq("id", lectureId);
  try {
    const { data: blob, error: dlErr } = await supabase.storage.from("space-files").download(audioPath);
    if (dlErr || !blob) throw new Error(dlErr?.message || "Could not read audio from storage.");
    // callAudio reserves the slot, picks the key for the plan and logs usage once.
    const { text: transcript } = await callAudio({ file: blob, filename: audioPath.split("/").pop() || "audio", purpose: "batch", task: "transcribe a lecture", supabase, userId: user.id, unmetered: isUnmetered(user.email), plan });
    await supabase.from("lectures_audio").update({ transcript, status: "done" }).eq("id", lectureId);
    try {
      const { data: lec } = await supabase.from("lectures_audio").select("title").eq("id", lectureId).maybeSingle();
      await reindexSource(supabase, spaceId, "lecture", lectureId, lec?.title ?? "Lecture", transcript);
    } catch { /* best-effort */ }
    revalidatePath(`/spaces/${spaceId}/lectures`);
    return {};
  } catch (e) {
    await supabase.from("lectures_audio").update({ status: "failed" }).eq("id", lectureId);
    return { error: friendlyError(e, "transcribe this lecture") };
  }
}

export async function deleteLecture(spaceId: string, lectureId: string, audioPath: string | null) {
  const { supabase } = await authed();
  if (audioPath) await supabase.storage.from("space-files").remove([audioPath]);
  const { error } = await supabase.from("lectures_audio").delete().eq("id", lectureId);
  if (error) return { error: error.message };
  revalidatePath(`/spaces/${spaceId}/lectures`);
  return {};
}

export async function createLectureRecord(spaceId: string, title: string, audioPath: string) {
  const { supabase, user } = await authed();
  const { data, error } = await supabase.from("lectures_audio").insert({ space_id: spaceId, title: title.trim() || "Untitled lecture", audio_path: audioPath, status: "uploaded", created_by: user.id }).select("id").single();
  if (error) return { error: error.message };
  revalidatePath(`/spaces/${spaceId}/lectures`);
  return { id: data?.id as string };
}

export async function generateStudyMaterials(spaceId: string, lectureId: string) {
  const { supabase, user } = await authed();
  const { data: lecture, error: readErr } = await supabase.from("lectures_audio").select("transcript, cards_generated, title").eq("id", lectureId).single();
  if (readErr) return { error: readErr.message };
  if (!lecture.transcript) return { error: "No transcript to work from yet." };
  if (lecture.cards_generated) return { error: "Study materials already generated for this lecture." };
  const SYSTEM = `You turn a lecture transcript into study materials for active recall. The learner must do the thinking; you build the scaffolding.
Return ONLY valid JSON, no markdown, in exactly this shape:
{
  "summary": "3-6 sentence plain-language overview of the key points.",
  "cards": [
    { "concept": "2-5 words", "question": "a question that forces retrieval (why/how/under what conditions)", "hint": "points toward the answer without giving it", "answer": "concise, factual answer — one or two sentences" }
  ]
}
Rules:
- 5 to 10 cards, one idea each. Only use content actually in the transcript.
- The hint must NOT contain the answer. The answer is separate and concise.
- No preamble, no code fences — JSON object only.`;
  try {
    const plan = (await enforceRateLimit(supabase, user)) ?? "free";
    const { content } = await callChat({ purpose: "batch", system: SYSTEM, user: lecture.transcript.slice(0, 8000), maxTokens: 1000, temperature: 0.3, json: true, supabase, userId: user.id, unmetered: isUnmetered(user.email), plan });
    const parsed = JSON.parse(content || "{}");
    const summary: string = parsed.summary ?? "";
    const cards = (parsed.cards ?? []).map((c: any) => ({ id: crypto.randomUUID(), concept: String(c.concept ?? "").slice(0, 120), question: String(c.question ?? "").slice(0, 500), hint: String(c.hint ?? "").slice(0, 500), answer: String(c.answer ?? "").slice(0, 800) })).filter((c: any) => c.question);
    const { data: deck, error: deckErr } = await supabase.from("active_recall_decks")
      .insert({ space_id: spaceId, title: `${lecture.title} · cards`, subject: "From lecture", cards_json: cards, created_by: user.id })
      .select("deck_id").single();
    if (deckErr) throw new Error(deckErr.message);
    await supabase.from("lectures_audio").update({ summary, cards_generated: true }).eq("id", lectureId);
    revalidatePath(`/spaces/${spaceId}/lectures`);
    revalidatePath(`/spaces/${spaceId}`);
    revalidatePath(`/spaces/${spaceId}/decks`);
    // The deck id lets the lectures page open the new cards straight away.
    return { count: cards.length, deckId: deck?.deck_id as string | undefined };
  } catch (e) {
    return { error: friendlyError(e, "generate this") };
  }
}

export async function completeOnboarding() {
  const { supabase, user } = await authed();
  await supabase.from("profiles").update({ onboarding_completed: true }).eq("id", user.id);
  return {};
}

export async function resetOnboarding() {
  const { supabase, user } = await authed();
  await supabase.from("profiles").update({ onboarding_completed: false }).eq("id", user.id);
  revalidatePath("/spaces");
  return {};
}

// Strip HTML tags from a Tiptap note body before handing it to the LLM.
function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Turns a note's content into a flashcard deck, same active-recall shape as generateStudyMaterials.
export async function generateCardsFromNote(spaceId: string, noteTitle: string, noteBody: string) {
  const { supabase, user } = await authed();
  const text = stripHtml(noteBody);
  if (!text) return { error: "This note has no content to generate cards from yet." };

  const SYSTEM = `You turn study notes into flashcards for active recall. The learner must do the thinking; you build the scaffolding.
Return ONLY valid JSON, no markdown, in exactly this shape:
{ "cards": [ { "concept": "2-5 words", "question": "a question that forces retrieval (why/how/under what conditions)", "hint": "points toward the answer without giving it" } ] }
Rules:
- 5 to 10 cards, one idea each. Only use content actually in the notes.
- The hint must NOT contain the answer.
- No preamble, no code fences — JSON object only.`;
  try {
    const parsed = await groqChat(SYSTEM, text.slice(0, 6000), 800);
    const cards = (parsed.cards ?? [])
      .map((c: any) => ({ id: crypto.randomUUID(), concept: String(c.concept ?? "").slice(0, 120), question: String(c.question ?? "").slice(0, 500), hint: String(c.hint ?? "").slice(0, 500) }))
      .filter((c: any) => c.question);
    if (cards.length === 0) throw new Error("Couldn't generate any cards from this note.");

    const { data: deck, error } = await supabase.from("active_recall_decks").insert({
      space_id: spaceId, title: `${noteTitle || "Untitled note"} · cards`, subject: "From notes", cards_json: cards, created_by: user.id,
    }).select("deck_id").single();
    if (error) throw new Error(error.message);

    revalidatePath(`/spaces/${spaceId}`);
    return { count: cards.length, deckId: deck?.deck_id as string | undefined };
  } catch (e) {
    return { error: friendlyError(e, "generate this") };
  }
}

export async function updateTheme(theme: string) {
  const { supabase, user } = await authed();
  const { error } = await supabase.from("profiles").update({ theme }).eq("id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/spaces");
  return {};
}

export async function updateMode(mode: string) {
  const { supabase, user } = await authed();
  const { error } = await supabase.from("profiles").update({ mode }).eq("id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/spaces");
  return {};
}

export async function createMindmap(spaceId: string, title: string, tree: unknown) {
  const { supabase, user } = await authed();
  const { data, error } = await supabase.from("mindmaps").insert({ space_id: spaceId, title, tree_json: tree, created_by: user.id }).select("id").single();
  if (error) return { error: error.message };
  revalidatePath(`/spaces/${spaceId}/maps`);
  return { id: data.id };
}

export async function deleteMindmap(spaceId: string, id: string) {
  const { supabase } = await authed();
  await supabase.from("mindmaps").delete().eq("id", id);
  revalidatePath(`/spaces/${spaceId}/maps`);
  return {};
}

export async function indexContent(spaceId: string, sourceType: "note" | "lecture" | "file", sourceId: string, sourceTitle: string, chunks: string[]) {
  const { supabase } = await authed();
  await supabase.from("content_chunks").delete().eq("source_id", sourceId);
  if (chunks.length === 0) return { count: 0 };
  const rows = chunks.map((content, i) => ({ space_id: spaceId, source_type: sourceType, source_id: sourceId, source_title: sourceTitle, chunk_index: i, content }));
  const { error } = await supabase.from("content_chunks").insert(rows);
  if (error) return { error: error.message };
  return { count: rows.length };
}

export async function unindexSource(sourceId: string) {
  const { supabase } = await authed();
  await supabase.from("content_chunks").delete().eq("source_id", sourceId);
  return {};
}

export async function reindexSpace(spaceId: string) {
  const { supabase } = await authed();
  const [{ data: notes }, { data: lectures }] = await Promise.all([
    supabase.from("notes").select("id, title, body").eq("space_id", spaceId),
    supabase.from("lectures_audio").select("id, title, transcript").eq("space_id", spaceId),
  ]);
  await supabase.from("content_chunks").delete().eq("space_id", spaceId).in("source_type", ["note", "lecture"]);
  const rows: any[] = [];
  const split = (text: string, target = 900) => {
    const sentences = text.match(/[^.!?]+[.!?]+["")]?\s*/g) ?? [text];
    const out: string[] = [];
    let cur = "";
    for (const s of sentences) {
      if (cur.length + s.length > target && cur) { out.push(cur.trim()); cur = ""; }
      cur += s;
    }
    if (cur.trim().length > 40) out.push(cur.trim());
    return out;
  };
  for (const n of notes ?? []) {
    // Handwritten pages: index only their converted text, never the stroke data.
    let src = n.body ?? "";
    if (src.startsWith("<!--ink:")) { try { src = JSON.parse(src.slice(8, src.lastIndexOf("-->"))).text ?? ""; } catch { src = ""; } }
    const plain = src.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    split(plain).forEach((content, i) => rows.push({ space_id: spaceId, source_type: "note", source_id: n.id, source_title: n.title || "Untitled note", chunk_index: i, content }));
  }
  for (const l of lectures ?? []) {
    if (!l.transcript) continue;
    split(l.transcript).forEach((content, i) => rows.push({ space_id: spaceId, source_type: "lecture", source_id: l.id, source_title: l.title || "Lecture", chunk_index: i, content }));
  }
  if (rows.length) {
    const { error } = await supabase.from("content_chunks").insert(rows);
    if (error) return { error: error.message };
  }
  return { count: rows.length };
}

export async function searchSpaceContent(spaceId: string, query: string) {
  const { supabase } = await authed();
  const { data, error } = await supabase.rpc("search_chunks", { p_space_id: spaceId, p_query: query, p_limit: 8 });
  if (error) return { error: error.message };
  return { results: data ?? [] };
}

export type AskSource = { n: number; type: string; title: string; id: string; snippet: string };

// Ask AI: one ranked retrieval + one model call. Grounded by default; "general" mode answers
// from general knowledge when the student's own material doesn't cover the question.
export async function chatWithSpace(
  spaceId: string,
  question: string,
  history: { role: "user" | "assistant"; content: string }[],
  mode: "grounded" | "general" = "grounded",
): Promise<{ answer: string; sources: AskSource[]; grounded: boolean; noMatch?: boolean } | { error: string }> {
  const { supabase, user } = await authed();
  let plan: "free" | "pro" | "admin" = "free";
  try { plan = (await enforceRateLimit(supabase, user, { purpose: "interactive" })) ?? "free"; } catch (e) { return { error: friendlyError(e, "answer your question") }; }

  // Strip any "(I'm currently reading…)" prefix the note panel adds, for search only.
  const searchQuery = question.replace(/^\([^)]*\)\s*/, "").trim();
  const prevQ = [...history].reverse().find((m) => m.role === "user")?.content;
  const recent = history.slice(-4).map((m) => ({ role: m.role, content: m.content.slice(0, 700) }));

  let passages: Awaited<ReturnType<typeof retrieve>> = [];
  // When nothing in the student's materials matches, answer from general knowledge instead of
  // dead-ending; the client shows an honest line (noMatch + grounded:false).
  let noMatch = false;
  if (mode === "grounded") {
    passages = await retrieve(supabase, spaceId, searchQuery, prevQ);
    if (!passages.length) { mode = "general"; noMatch = true; }
  }

  const context = passages.map((p, i) => `[${i + 1}] ${p.source_type} · ${p.source_title}\n${p.context}`).join("\n\n");
  const SYSTEM = mode === "grounded"
    ? `You are Logia, a study assistant. Answer using ONLY the numbered passages from the student's own materials.
Rules:
- Put a citation after every claim, like [1] or [2][3]. Never cite a passage that doesn't support the claim.
- If the passages only partly answer, answer that part and say plainly what's missing. If they don't answer it, say so.
- Lead with the direct answer in 1-2 sentences, then explain. Use short paragraphs, **bold** for key terms, and "- " bullets or "1. " steps when it helps.
- Keep formulas, numbers and definitions exactly as written in the passages.
- No preamble, no restating the question, under 220 words unless asked for more.

PASSAGES:
${context}`
    : `You are Logia, a study assistant. The student's own notes don't cover this question, so answer from general knowledge.
Be accurate and concise (under 200 words). Use **bold** for key terms and "- " bullets where helpful. If something depends on their course or lecturer, say so. Don't invent citations.`;

  try {
    const out = await callChat({
      purpose: "interactive", system: SYSTEM, messages: recent, user: question, maxTokens: 600, supabase, userId: user.id, unmetered: isUnmetered(user.email), plan,
    });
    const answer: string = out.content.trim() || "I couldn't put an answer together. Try asking again.";

    // Only return the passages the answer actually cites, numbered as cited.
    const cited = [...new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))].filter((n) => n >= 1 && n <= passages.length);
    const sources: AskSource[] = cited.map((n) => {
      const p = passages[n - 1];
      return { n, type: p.source_type, title: p.source_title, id: p.source_id, snippet: p.content.slice(0, 220) };
    });
    return { answer, sources, grounded: mode === "grounded", ...(noMatch ? { noMatch: true } : {}) };
  } catch (e) {
    return { error: friendlyError(e, "answer your question") };
  }
}

/** Starter questions built from the titles of what's actually in the space. */
export async function getAskSuggestions(spaceId: string) {
  const fallback = ["What are the main ideas in my notes?", "What should I revise first?"];
  let supabase;
  try { ({ supabase } = await authed()); } catch { return fallback; }
  const { data } = await supabase.from("content_chunks").select("source_title, source_type").eq("space_id", spaceId).eq("chunk_index", 0).limit(30);
  const titles = [...new Set((data ?? []).map((r) => r.source_title as string).filter(Boolean))].slice(0, 3);
  const out = titles.flatMap((t, i) => [i === 0 ? `Summarise “${t}” in five points` : i === 1 ? `What are the key terms in “${t}”?` : `Quiz me on “${t}”`]);
  return out.length ? out : fallback;
}

export async function saveArticle(spaceId: string, article: {
  semantic_scholar_id?: string; doi?: string; title: string; authors: string[];
  year?: number; abstract?: string; venue?: string; citation_count?: number; open_access_url?: string;
}) {
  const { supabase, user } = await authed();
  if (article.semantic_scholar_id) {
    const { data: existing } = await supabase.from("scholarly_articles").select("id").eq("space_id", spaceId).eq("semantic_scholar_id", article.semantic_scholar_id).maybeSingle();
    if (existing) return { error: "Already saved to this space." };
  }
  const { data, error } = await supabase.from("scholarly_articles").insert({ space_id: spaceId, saved_by: user.id, ...article }).select("id").single();
  if (error) return { error: error.message };
  if (article.abstract && article.abstract.length > 50) {
    const split = (text: string, target = 900) => {
      const sentences = text.match(/[^.!?]+[.!?]+["")]?\s*/g) ?? [text];
      const out: string[] = []; let cur = "";
      for (const s of sentences) { if (cur.length + s.length > target && cur) { out.push(cur.trim()); cur = ""; } cur += s; }
      if (cur.trim().length > 40) out.push(cur.trim());
      return out;
    };
    const label = `${article.title}${article.year ? ` (${article.year})` : ""}`;
    const chunks = split(article.abstract).map((content, i) => ({ space_id: spaceId, source_type: "article" as const, source_id: data.id, source_title: label, chunk_index: i, content }));
    if (chunks.length) await supabase.from("content_chunks").insert(chunks);
  }
  revalidatePath(`/spaces/${spaceId}/articles`);
  return { id: data.id };
}

export async function deleteArticle(spaceId: string, articleId: string) {
  const { supabase } = await authed();
  await supabase.from("content_chunks").delete().eq("source_id", articleId);
  await supabase.from("scholarly_articles").delete().eq("id", articleId);
  revalidatePath(`/spaces/${spaceId}/articles`);
  return {};
}

export async function searchScholar(query: string) {
  const params = new URLSearchParams({ query, fields: "paperId,title,authors,year,abstract,venue,citationCount,openAccessPdf,externalIds", limit: "10" });
  try {
    const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?${params}`);
    if (!res.ok) return { error: `Search failed (${res.status})` };
    const json = await res.json();
    return { results: json.data ?? [] };
  } catch (e) {
    return { error: friendlyError(e, "search papers") };
  }
}

export async function getNoteMediaSignedUrl(path: string) {
  const { supabase } = await authed();
  const { data, error } = await supabase.storage.from("space-files").createSignedUrl(path, 60 * 60 * 24 * 365);
  if (error) return { error: error.message };
  return { url: data.signedUrl };
}

// Past paper & worksheet engine ------------------------------------------


// Marks a student's answered paper against the memo in one pass: extracts each question,
// the student's written answer, the memo answer, and pinpoints where they went wrong.
export async function generatePastPaper(spaceId: string, title: string, paperText: string, memoText: string) {
  const { supabase, user } = await authed();
  const SYSTEM = `You are a strict but fair exam marker. You receive a student's ANSWERED exam paper and the official memo.
For every question, extract the question, the student's answer as written on the paper, and the memo answer, then mark it.
Return ONLY valid JSON, no markdown, in exactly this shape:
{ "questions": [ { "question_text": "...", "student_answer": "...", "memo_answer": "...", "is_correct": true | false, "feedback": "...", "topic": "2-4 word topic label", "difficulty": "easy" | "medium" | "hard" } ] }
Rules:
- Match questions to memo answers by question number.
- If the student left a question blank, student_answer is "" and is_correct is false.
- is_correct is true only if the answer earns full marks per the memo.
- feedback: 1-3 sentences naming exactly where the student diverged from the memo (missing point, wrong step, wrong term), or confirming what earned the marks.
- Write each issue as its own sentence. When an issue is in something the student wrote, quote their exact words in double quotes (e.g. The student wrote "mitosis" where the memo requires meiosis.).
- No preamble, no code fences — JSON object only.`;
  try {
    const parsed = await groqChat(SYSTEM, `ANSWERED PAPER:\n${paperText.slice(0, 9000)}\n\nMEMO:\n${memoText.slice(0, 6000)}`, 3500, "batch", "mark a whole paper");
    const items = (parsed.questions ?? [])
      .map((q: any) => ({
        question_text: String(q.question_text ?? "").slice(0, 2000),
        memo_answer: String(q.memo_answer ?? "").slice(0, 2000),
        student_answer: String(q.student_answer ?? "").slice(0, 3000),
        is_correct: Boolean(q.is_correct),
        feedback: String(q.feedback ?? "").slice(0, 800),
        topic: q.topic ? String(q.topic).slice(0, 80) : null,
        difficulty: ["easy", "medium", "hard"].includes(q.difficulty) ? q.difficulty : "medium",
      }))
      .filter((q: any) => q.question_text && q.memo_answer);
    if (items.length === 0) throw new Error("Couldn't match the questions to the memo. Check the memo is for the same paper.");

    const { data: paper, error: paperErr } = await supabase
      .from("past_papers").insert({ space_id: spaceId, title, created_by: user.id }).select("id").single();
    if (paperErr) throw new Error(paperErr.message);

    const { data: inserted, error: qErr } = await supabase.from("paper_questions").insert(
      items.map((q: any) => ({
        question_text: q.question_text, memo_answer: q.memo_answer, topic: q.topic, difficulty: q.difficulty,
        paper_id: paper.id, space_id: spaceId,
      }))
    ).select("id");
    if (qErr) throw new Error(qErr.message);

    const { error: aErr } = await supabase.from("question_attempts").insert(
      (inserted ?? []).map((row, i) => ({
        question_id: row.id, user_id: user.id, space_id: spaceId,
        student_answer: items[i].student_answer, is_correct: items[i].is_correct,
        feedback: items[i].feedback || "No feedback generated.",
      }))
    );
    if (aErr) throw new Error(aErr.message);

    // Every wrong answer feeds the student's pain points list (grouped by topic).
    for (const q of items.filter((it: any) => !it.is_correct)) {
      await upsertPainPoint(supabase, user.id, spaceId, {
        title: q.topic ? `Mistakes on ${q.topic}` : q.question_text.slice(0, 80),
        description: q.feedback, topic: q.topic, source: "paper",
      });
    }

    revalidatePath(`/spaces/${spaceId}/papers`);
    revalidatePath(`/spaces/${spaceId}/pain-points`);
    return { paperId: paper.id, count: items.length };
  } catch (e) {
    return { error: friendlyError(e, "generate this") };
  }
}

export async function deletePastPaper(spaceId: string, paperId: string) {
  const { supabase } = await authed();
  await supabase.from("past_papers").delete().eq("id", paperId);
  revalidatePath(`/spaces/${spaceId}/papers`);
  return {};
}

// Grades a student's attempt against the memo and pinpoints where they diverged.
export async function attemptQuestion(spaceId: string, questionId: string, studentAnswer: string) {
  const { supabase, user } = await authed();
  const { data: q, error: qErr } = await supabase
    .from("paper_questions").select("question_text, memo_answer").eq("id", questionId).single();
  if (qErr || !q) return { error: "Question not found." };

  const SYSTEM = `You are a strict but fair exam marker. Compare the student's answer to the memo (model answer).
Return ONLY valid JSON, no markdown, in exactly this shape:
{ "is_correct": true | false, "feedback": "1-3 sentences pinpointing exactly where the student diverged from the memo, or confirming what they got right. Be specific — reference the exact step, term, or concept." }
Rules:
- is_correct is true only if the answer captures everything the memo requires for full marks.
- Never just say "wrong" — name the specific missing or incorrect part.
- Write each issue as its own sentence. When an issue is in something the student wrote, quote their exact words in double quotes (e.g. The student wrote "mitosis" where the memo requires meiosis.).
- No preamble, no code fences — JSON object only.`;
  try {
    const parsed = await groqChat(
      SYSTEM,
      `QUESTION:\n${q.question_text}\n\nMEMO ANSWER:\n${q.memo_answer}\n\nSTUDENT ANSWER:\n${studentAnswer.slice(0, 1200)}`,
      350
    );
    const is_correct = Boolean(parsed.is_correct);
    const feedback = String(parsed.feedback ?? "").slice(0, 500) || "No feedback generated.";

    const { error: insErr } = await supabase.from("question_attempts").insert({
      question_id: questionId, user_id: user.id, space_id: spaceId,
      student_answer: studentAnswer.slice(0, 3000), is_correct, feedback,
    });
    if (insErr) throw new Error(insErr.message);

    return { is_correct, feedback };
  } catch (e) {
    return { error: friendlyError(e, "mark your answer") };
  }
}

// After a missed attempt: generate a few fresh questions at the same topic/difficulty
// to drill the specific weakness, and add them to the same paper's bank.
export async function generateSimilarQuestions(spaceId: string, questionId: string) {
  const { supabase } = await authed();
  const { data: q, error: qErr } = await supabase
    .from("paper_questions").select("paper_id, question_text, memo_answer, topic, difficulty").eq("id", questionId).single();
  if (qErr || !q) return { error: "Question not found." };

  const SYSTEM = `You write exam-style drill questions. Given a question the student got wrong (and its memo answer), write 3 NEW questions
that test the exact same concept and difficulty, so the student can practice until it sticks.
Return ONLY valid JSON, no markdown, in exactly this shape:
{ "questions": [ { "question_text": "...", "memo_answer": "..." } ] }
Rules:
- Exactly 3 questions, each different from the original and from each other, same topic and difficulty level.
- memo_answer must be concise but complete enough to grade against.
- No preamble, no code fences — JSON object only.`;
  try {
    const parsed = await groqChat(
      SYSTEM,
      `ORIGINAL QUESTION:\n${q.question_text}\n\nMEMO ANSWER:\n${q.memo_answer}\n\nTOPIC: ${q.topic ?? "unspecified"}\nDIFFICULTY: ${q.difficulty}`,
      650
    );
    const fresh = (parsed.questions ?? [])
      .map((x: any) => ({
        question_text: String(x.question_text ?? "").slice(0, 2000),
        memo_answer: String(x.memo_answer ?? "").slice(0, 2000),
        topic: q.topic, difficulty: q.difficulty, paper_id: q.paper_id, space_id: spaceId,
      }))
      .filter((x: any) => x.question_text && x.memo_answer);
    if (fresh.length === 0) throw new Error("Couldn't generate similar questions. Try again.");

    const { data: inserted, error: insErr } = await supabase.from("paper_questions").insert(fresh).select("id, paper_id, question_text, memo_answer, topic, difficulty");
    if (insErr) throw new Error(insErr.message);

    revalidatePath(`/spaces/${spaceId}/papers/${q.paper_id}`);
    return { questions: inserted };
  } catch (e) {
    return { error: friendlyError(e, "generate this") };
  }
}

// After marking: builds a practice set targeting the topics the student got wrong,
// saved as its own "<title> — practice" paper so the marked original stays untouched.
export async function generateMoreFromPaper(spaceId: string, paperId: string) {
  const { supabase, user } = await authed();
  const [{ data: paper }, { data: existing, error: qErr }] = await Promise.all([
    supabase.from("past_papers").select("title").eq("id", paperId).single(),
    supabase.from("paper_questions").select("id, question_text, topic, difficulty").eq("paper_id", paperId).limit(15),
  ]);
  if (qErr || !existing || existing.length === 0) return { error: "No questions found for this paper." };

  const { data: attempts } = await supabase
    .from("question_attempts").select("question_id, is_correct").eq("user_id", user.id).in("question_id", existing.map((q) => q.id));
  const wrong = new Set((attempts ?? []).filter((a) => !a.is_correct).map((a) => a.question_id));
  const focus = existing.filter((q) => wrong.has(q.id));
  const source = focus.length > 0 ? focus : existing;

  const outline = source.map((q, i) => `${i + 1}. [${q.topic ?? "general"} / ${q.difficulty}] ${q.question_text}`).join("\n");

  const SYSTEM = `You write exam-style practice questions targeting the topics a student got wrong on a past paper.
Return ONLY valid JSON, no markdown, in exactly this shape:
{ "questions": [ { "question_text": "...", "memo_answer": "...", "topic": "2-4 word topic label", "difficulty": "easy" | "medium" | "hard" } ] }
Rules:
- Write 5 new questions testing the same concepts and difficulty as the listed ones — not copies.
- memo_answer must be concise but complete enough to grade against.
- No preamble, no code fences — JSON object only.`;
  try {
    const parsed = await groqChat(SYSTEM, `QUESTIONS THE STUDENT GOT WRONG:\n${outline}`, 1200);
    const fresh = (parsed.questions ?? [])
      .map((x: any) => ({
        question_text: String(x.question_text ?? "").slice(0, 2000),
        memo_answer: String(x.memo_answer ?? "").slice(0, 2000),
        topic: x.topic ? String(x.topic).slice(0, 80) : null,
        difficulty: ["easy", "medium", "hard"].includes(x.difficulty) ? x.difficulty : "medium",
      }))
      .filter((x: any) => x.question_text && x.memo_answer);
    if (fresh.length === 0) throw new Error("Couldn't generate practice questions. Try again.");

    const practiceTitle = `${paper?.title ?? "Paper"} · practice`;
    let { data: practice } = await supabase.from("past_papers").select("id").eq("space_id", spaceId).eq("title", practiceTitle).maybeSingle();
    if (!practice) {
      const { data: created, error: pErr } = await supabase.from("past_papers")
        .insert({ space_id: spaceId, title: practiceTitle, created_by: user.id }).select("id").single();
      if (pErr) throw new Error(pErr.message);
      practice = created;
    }

    const { data: inserted, error: insErr } = await supabase.from("paper_questions")
      .insert(fresh.map((x: any) => ({ ...x, paper_id: practice!.id, space_id: spaceId })))
      .select("id, paper_id, question_text, memo_answer, topic, difficulty");
    if (insErr) throw new Error(insErr.message);

    revalidatePath(`/spaces/${spaceId}/papers`);
    return { questions: inserted };
  } catch (e) {
    return { error: friendlyError(e, "generate this") };
  }
}

// Tier 2 — Notes-to-Cards pipeline -----------------------------------------

// Highlight text in a note -> the selection becomes the card's answer; the LLM writes the question.
// Cards land in a "<note> — highlights" deck so they stay grouped and linked back to the note.
export async function generateCardFromSelection(spaceId: string, noteId: string, noteTitle: string, selection: string) {
  const { supabase, user } = await authed();
  const text = selection.trim().slice(0, 1000);
  if (!text) return { error: "Select some text first." };

  const SYSTEM = `You write one active-recall flashcard whose ANSWER is text the student highlighted in their notes.
Return ONLY valid JSON, no markdown, in exactly this shape:
{ "concept": "2-5 words", "question": "a question this exact text answers — phrase it so the highlight is the correct response", "hint": "points toward the answer without giving it away" }
No preamble, no code fences — JSON object only.`;
  try {
    const parsed = await groqChat(SYSTEM, text, 320);
    const card = {
      id: crypto.randomUUID(),
      concept: String(parsed.concept ?? "").slice(0, 120) || "Highlight",
      question: String(parsed.question ?? "").slice(0, 500),
      hint: String(parsed.hint ?? "").slice(0, 500),
      answer: text,
      sourceNoteId: noteId,
    };
    if (!card.question) throw new Error("Couldn't turn that highlight into a question. Try selecting a longer passage.");

    const deckTitle = `${noteTitle || "Untitled note"} · highlights`;
    const { data: existing } = await supabase.from("active_recall_decks").select("deck_id, cards_json").eq("space_id", spaceId).eq("title", deckTitle).maybeSingle();

    if (existing) {
      const cards = [...((existing.cards_json as Card[]) ?? []), card];
      const { error } = await supabase.from("active_recall_decks").update({ cards_json: cards }).eq("deck_id", existing.deck_id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("active_recall_decks").insert({
        space_id: spaceId, title: deckTitle, subject: "From highlights", cards_json: [card], created_by: user.id,
      });
      if (error) throw new Error(error.message);
    }

    revalidatePath(`/spaces/${spaceId}`);
    return { card };
  } catch (e) {
    return { error: friendlyError(e, "generate this") };
  }
}

// Tier 2 — Active recall prompts -------------------------------------------

// Ungraded self-test questions generated from a note's content — nothing is stored or scored.
export async function generateRecallPrompts(noteBody: string) {
  const text = stripHtml(noteBody);
  if (!text) return { error: "This note has no content yet." };
  const SYSTEM = `Write 3-5 short comprehension questions that test whether someone understood the following notes.
These are NOT graded — just prompts for the reader to test themselves before moving on.
Return ONLY valid JSON, no markdown, in exactly this shape: { "questions": ["...", "..."] }
No preamble, no code fences — JSON object only.`;
  try {
    const parsed = await groqChat(SYSTEM, text.slice(0, 5000), 450);
    const questions = (parsed.questions ?? []).map((q: any) => String(q).slice(0, 200)).filter(Boolean).slice(0, 5);
    if (questions.length === 0) throw new Error("Couldn't generate prompts for this note.");
    return { questions };
  } catch (e) {
    return { error: friendlyError(e, "generate this") };
  }
}

// Tier 2 — Pomodoro / study sessions -----------------------------------------
// logFocusSession already exists above — the timer UI calls it directly.

// Tier 2 — Concept linker ----------------------------------------------------

// Searches this user's OTHER spaces for passages related to a flashcard's concept,
// surfacing cross-space connections ("you have notes on this in Econ 201").
export async function findRelatedNotes(concept: string, excludeSpaceId: string) {
  const { supabase } = await authed();
  const { data: spaces } = await supabase.from("spaces").select("id, name").neq("id", excludeSpaceId);
  if (!spaces || spaces.length === 0) return { results: [] };

  const results: { spaceId: string; spaceName: string; sourceTitle: string; sourceType: string; snippet: string }[] = [];
  for (const s of spaces) {
    try {
      const { data } = await supabase.rpc("search_chunks", { p_space_id: s.id, p_query: concept, p_limit: 2 });
      for (const row of data ?? []) {
        results.push({ spaceId: s.id, spaceName: s.name, sourceTitle: row.source_title, sourceType: row.source_type, snippet: String(row.content).slice(0, 160) });
      }
    } catch { /* space may have no indexed content yet */ }
    if (results.length >= 5) break;
  }
  return { results: results.slice(0, 5) };
}

// Tier 2 — Collaborative decks: upvotes -------------------------------------

export async function voteCard(deckId: string, cardId: string) {
  const { supabase, user } = await authed();
  const { error } = await supabase.from("card_votes").upsert({ deck_id: deckId, card_id: cardId, user_id: user.id }, { onConflict: "card_id,user_id" });
  if (error) return { error: error.message };
  const { count } = await supabase.from("card_votes").select("*", { count: "exact", head: true }).eq("card_id", cardId);
  return { votes: count ?? 0 };
}

// Tier 3 — Formula sheet builder ---------------------------------------------

export async function addFormula(spaceId: string, label: string, latex: string, topic: string) {
  const { supabase, user } = await authed();
  if (!label.trim() || !latex.trim()) return { error: "Both a label and the formula are required." };
  const { error } = await supabase.from("formulas").insert({
    space_id: spaceId, label: label.slice(0, 160), latex: latex.slice(0, 500), topic: topic.trim() || null, created_by: user.id,
  });
  if (error) return { error: error.message };
  revalidatePath(`/spaces/${spaceId}/formulas`);
  return {};
}

export async function deleteFormula(spaceId: string, id: string) {
  const { supabase } = await authed();
  await supabase.from("formulas").delete().eq("id", id);
  revalidatePath(`/spaces/${spaceId}/formulas`);
  return {};
}

// Tier 3 — Explain Like I'm Five ---------------------------------------------

export async function explainSimply(text: string) {
  const SYSTEM = `Re-explain the following concept as simply as possible, as if to a curious beginner.
Use a short, concrete analogy. 3-5 sentences, plain language, no jargon.
Return ONLY valid JSON, no markdown, in exactly this shape: { "explanation": "..." }`;
  try {
    const parsed = await groqChat(SYSTEM, text.slice(0, 1200), 400);
    const explanation = String(parsed.explanation ?? "").slice(0, 1000);
    if (!explanation) throw new Error("Couldn't generate an explanation.");
    return { explanation };
  } catch (e) {
    return { error: friendlyError(e, "generate this") };
  }
}

export async function getCardVotes(cardIds: string[]) {
  if (cardIds.length === 0) return {};
  const { supabase } = await authed();
  const { data } = await supabase.from("card_votes").select("card_id").in("card_id", cardIds);
  const counts: Record<string, number> = {};
  for (const row of data ?? []) counts[row.card_id] = (counts[row.card_id] ?? 0) + 1;
  return counts;
}

// ── Practice Quiz Mode ───────────────────────────────────────────────────────

export type QuizQuestion = { question: string; options: string[]; answerIndex: number; explanation: string };

// Builds a multiple-choice quiz from a deck, with plausible distractors written by the LLM.
export async function generateQuiz(deckId: string) {
  const { supabase } = await authed();
  const { data: deck } = await supabase.from("active_recall_decks").select("title, cards_json").eq("deck_id", deckId).single();
  const cards = ((deck?.cards_json as Card[]) ?? []).slice(0, 12);
  if (cards.length < 2) return { error: "Add at least 2 cards to this deck before taking a quiz." };

  const source = cards.map((c, i) => `${i + 1}. [${c.concept}] ${c.question}${c.answer ? ` → ${c.answer}` : ""}`).join("\n");
  const SYSTEM = `You write a multiple-choice quiz from a student's flashcards.
Return ONLY valid JSON, no markdown, in exactly this shape:
{ "questions": [ { "question": "...", "options": ["...", "...", "...", "..."], "answerIndex": 0, "explanation": "one sentence on why the answer is right" } ] }
Rules:
- One question per flashcard, max ${cards.length}. Exactly 4 options each.
- Distractors must be plausible — common misconceptions, not obviously wrong.
- Vary the position of the correct answer.
- Only use content from the cards.`;
  try {
    const parsed = await groqChat(SYSTEM, source, 2200);
    // The model tends to put the right answer first, so keep the correct option + 3 distractors
    // and shuffle them ourselves.
    const questions: QuizQuestion[] = (parsed.questions ?? [])
      .map((q: any) => {
        const opts: string[] = (Array.isArray(q.options) ? q.options : []).map((o: any) => String(o).slice(0, 300));
        const ai = Number(q.answerIndex);
        if (!q.question || !(ai >= 0 && ai < opts.length) || opts.length < 4) return null;
        const correct = opts[ai];
        const pool = [correct, ...opts.filter((_, i) => i !== ai).slice(0, 3)];
        for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
        return {
          question: String(q.question).slice(0, 500),
          options: pool,
          answerIndex: pool.indexOf(correct),
          explanation: String(q.explanation ?? "").slice(0, 400),
        };
      })
      .filter((q: QuizQuestion | null): q is QuizQuestion => q !== null);
    if (questions.length === 0) throw new Error("Couldn't build a quiz from this deck. Try again.");
    return { title: (deck?.title as string) ?? "Quiz", questions };
  } catch (e) {
    return { error: friendlyError(e, "build the quiz") };
  }
}

export async function saveQuizAttempt(spaceId: string, deckId: string, score: number, total: number) {
  const { supabase, user } = await authed();
  await supabase.from("quiz_attempts").insert({ user_id: user.id, space_id: spaceId, deck_id: deckId, score, total });
  revalidatePath(`/spaces/${spaceId}/analytics`);
  return {};
}

// ── Pain Points ──────────────────────────────────────────────────────────────

// Adds a pain point, or bumps the hit count if an open one on the same topic/title exists.
async function upsertPainPoint(
  supabase: Awaited<ReturnType<typeof createClient>>, userId: string, spaceId: string,
  p: { title: string; description: string; topic: string | null; source: string },
) {
  const base = supabase.from("pain_points").select("id, hits").eq("user_id", userId).eq("space_id", spaceId).eq("resolved", false);
  const { data: existing } = await (p.topic ? base.eq("topic", p.topic) : base.eq("title", p.title)).limit(1).maybeSingle();
  if (existing) {
    await supabase.from("pain_points").update({ hits: existing.hits + 1, description: p.description || undefined, updated_at: new Date().toISOString() }).eq("id", existing.id);
  } else {
    await supabase.from("pain_points").insert({ user_id: userId, space_id: spaceId, ...p });
  }
}

export async function addPainPoint(spaceId: string, title: string, description: string, topic: string) {
  const { supabase, user } = await authed();
  if (!title.trim()) return { error: "Give it a short title." };
  await upsertPainPoint(supabase, user.id, spaceId, { title: title.trim().slice(0, 160), description: description.slice(0, 1000), topic: topic.trim() || null, source: "manual" });
  revalidatePath(`/spaces/${spaceId}/pain-points`);
  return {};
}

export async function setPainPointResolved(spaceId: string, id: string, resolved: boolean) {
  const { supabase } = await authed();
  await supabase.from("pain_points").update({ resolved, updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath(`/spaces/${spaceId}/pain-points`);
  return {};
}

export async function deletePainPoint(spaceId: string, id: string) {
  const { supabase } = await authed();
  await supabase.from("pain_points").delete().eq("id", id);
  revalidatePath(`/spaces/${spaceId}/pain-points`);
  return {};
}

// One-tap "add to pain points" from a marked past-paper question.
export async function painPointFromQuestion(spaceId: string, questionId: string) {
  const { supabase, user } = await authed();
  const [{ data: q }, { data: a }] = await Promise.all([
    supabase.from("paper_questions").select("question_text, topic").eq("id", questionId).single(),
    supabase.from("question_attempts").select("feedback").eq("question_id", questionId).eq("user_id", user.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!q) return { error: "Question not found." };
  await upsertPainPoint(supabase, user.id, spaceId, {
    title: q.topic ? `Mistakes on ${q.topic}` : q.question_text.slice(0, 80),
    description: a?.feedback ?? "",
    topic: q.topic, source: "paper",
  });
  revalidatePath(`/spaces/${spaceId}/pain-points`);
  return {};
}

// ── Deck language tags ───────────────────────────────────────────────────────

export async function updateDeckLanguages(spaceId: string, deckId: string, front: string, back: string) {
  const { supabase } = await authed();
  const { error } = await supabase.from("active_recall_decks").update({ front_language: front, back_language: back }).eq("deck_id", deckId);
  if (error) return { error: error.message };
  revalidatePath(`/spaces/${spaceId}/decks/${deckId}`);
  return {};
}

// ── Onboarding persona ───────────────────────────────────────────────────────

export async function savePersona(persona: string) {
  const { supabase, user } = await authed();
  await supabase.from("profiles").update({ persona }).eq("id", user.id);
  revalidatePath("/spaces");
  return {};
}

// ── Scan to Import (camera → OCR) ────────────────────────────────────────────

// Transcribes photographed pages with Groq's vision model. Images arrive as JPEG data URLs.
export async function scanPagesToText(images: string[], mathHeavy: boolean) {
  const { supabase, user } = await authed();
  const plan = (await enforceRateLimit(supabase, user)) ?? "free";
  if (images.length === 0) return { error: "Capture at least one page." };
  const instruction = mathHeavy
    ? "Transcribe this page exactly. Write all mathematics as LaTeX inside $...$ (inline) or $$...$$ (display). Keep question numbers, answers and line breaks. Output only the transcription."
    : "Transcribe this page exactly, keeping headings, question numbers, answers, bullet points and line breaks. Output only the transcription.";
  try {
    const parts: string[] = [];
    // One page per request keeps each call well inside the model's image limits.
    for (const img of images.slice(0, 10)) {
      const { content } = await callVision({
        purpose: "interactive", imageDataUrls: [img], text: instruction, maxTokens: 2500, task: "scan pages",
        supabase, userId: user.id, unmetered: isUnmetered(user.email), plan,
      });
      parts.push(content);
    }
    const text = parts.join("\n\n");
    if (!text.trim()) throw new Error("Couldn't read any text. Try a sharper photo in good light.");
    return { text };
  } catch (e) {
    return { error: friendlyError(e, "read the scanned pages") };
  }
}

// Saves scanned text as a new note in a "Scanned" folder.
export async function createNoteFromText(spaceId: string, title: string, text: string, folder = "Scanned") {
  const { supabase, user } = await authed();
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = text.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const folderName = folder.slice(0, 40) || "Scanned";
  const nbId = await notebookIdForName(supabase, spaceId, user.id, folderName);
  const { data, error } = await supabase.from("notes")
    .insert({ space_id: spaceId, folder: folderName, ...(nbId ? { notebook_id: nbId } : {}), title: title || "Scanned note", body, created_by: user.id }).select("id").single();
  if (error) return { error: error.message };
  try { await reindexSource(supabase, spaceId, "note", data.id, title || "Scanned note", text); } catch { /* best-effort */ }
  revalidatePath(`/spaces/${spaceId}/notes`);
  return { id: data.id as string };
}

// ── Rename uploads (display names only — stored files keep their paths) ─────────

const RENAMABLE = {
  file:    { table: "files",          column: "name",  path: (s: string) => `/spaces/${s}/files` },
  paper:   { table: "past_papers",    column: "title", path: (s: string) => `/spaces/${s}/papers` },
  lecture: { table: "lectures_audio", column: "title", path: (s: string) => `/spaces/${s}/lectures` },
  mindmap: { table: "mindmaps",       column: "title", path: (s: string) => `/spaces/${s}/maps` },
} as const;

export async function renameUpload(kind: keyof typeof RENAMABLE, spaceId: string, id: string, name: string) {
  const { supabase } = await authed();
  const clean = name.trim().slice(0, 200);
  if (!clean) return { error: "The name can't be empty." };
  const cfg = RENAMABLE[kind];
  const { error } = await supabase.from(cfg.table).update({ [cfg.column]: clean }).eq("id", id);
  if (error) return { error: friendlyError(error, "rename this") };
  revalidatePath(cfg.path(spaceId));
  return {};
}
// ── Customisable dashboard ─────────────────────────────────────────────────────

export async function saveDashboardLayout(layout: { id: string; visible: boolean }[]) {
  const { supabase, user } = await authed();
  const clean = layout.slice(0, 20).map((w) => ({ id: String(w.id).slice(0, 40), visible: Boolean(w.visible) }));
  const { error } = await supabase.from("profiles").update({ dashboard_widgets: clean }).eq("id", user.id);
  if (error) return { error: friendlyError(error, "save your dashboard layout") };
  revalidatePath("/spaces");
  return {};
}

// Autosave for the mind-map editor (structure, labels, notes, collapsed state).
export async function updateMindmap(spaceId: string, id: string, tree: unknown, title?: string) {
  const { supabase } = await authed();
  const patch: Record<string, unknown> = { tree_json: tree };
  if (title?.trim()) patch.title = title.trim().slice(0, 200);
  const { error } = await supabase.from("mindmaps").update(patch).eq("id", id);
  if (error) return { error: friendlyError(error, "save your mind map") };
  revalidatePath(`/spaces/${spaceId}/maps`);
  return {};
}

// Rename a notes folder (legacy label); also renames the matching notebook.
export async function renameNoteFolder(spaceId: string, from: string, to: string) {
  const { supabase } = await authed();
  const name = to.trim().slice(0, 40);
  if (!name) return { error: "The folder needs a name." };
  if (name === from) return {};
  const { error } = await supabase.from("notes").update({ folder: name }).eq("space_id", spaceId).eq("folder", from);
  if (error) return { error: error.message };
  await supabase.from("notebooks").update({ name, updated_at: new Date().toISOString() }).eq("space_id", spaceId).ilike("name", from.replace(/[%_\\]/g, "\\$&"));
  revalidatePath(`/spaces/${spaceId}/notes`);
  return {};
}

// Same for files.
export async function renameFileFolder(spaceId: string, from: string, to: string) {
  const { supabase } = await authed();
  const name = to.trim().slice(0, 40);
  if (!name) return { error: "The folder needs a name." };
  if (name === from) return {};
  const { error } = await supabase.from("files").update({ folder: name }).eq("space_id", spaceId).eq("folder", from);
  if (error) return { error: error.message };
  revalidatePath(`/spaces/${spaceId}/files`);
  return {};
}

export async function moveFile(spaceId: string, fileId: string, folder: string) {
  const { supabase } = await authed();
  const { error } = await supabase.from("files").update({ folder: folder.trim().slice(0, 40) || "General" }).eq("id", fileId).eq("space_id", spaceId);
  if (error) return { error: error.message };
  revalidatePath(`/spaces/${spaceId}/files`);
  return {};
}

// Short-lived preview links for a page of files (one batched request).
export async function getFilePreviewUrls(spaceId: string, ids: string[]) {
  const { supabase } = await authed();
  const { data: rows } = await supabase.from("files").select("id, path").eq("space_id", spaceId).in("id", ids.slice(0, 60));
  if (!rows?.length) return {};
  const { data } = await supabase.storage.from("space-files").createSignedUrls(rows.map((r) => r.path), 60 * 30);
  const byPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  return Object.fromEntries(rows.map((r) => [r.id, byPath.get(r.path) ?? null])) as Record<string, string | null>;
}

// Study notes from a file's text. The model returns structure (not HTML); we build escaped
// HTML ourselves so nothing it writes can inject markup into the note.
export async function generateNotesFromText(spaceId: string, fileName: string, text: string, notebook = "From files") {
  const { supabase, user } = await authed();
  const source = text.replace(/\s+\n/g, "\n").trim();
  if (source.length < 200) return { error: "There isn't enough readable text in this file to make notes from." };
  const SYSTEM = `You turn course material into clear, well-structured study notes for a university student.
Return ONLY JSON: { "title": "short title", "summary": "2-3 sentence overview",
  "sections": [ { "heading": "section heading", "points": ["concise point in the student's language", ...],
  "terms": [ { "term": "key term", "definition": "one-line definition" } ] } ] }
Rules: 3-8 sections following the material's own order; 3-7 points each; keep facts, numbers and formulas exactly as in the source; no filler; no preamble.`;
  try {
    const parsed = await groqChat(SYSTEM, `FILE: ${fileName}\n\n${source.slice(0, 14000)}`, 2200);
    const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const sections = Array.isArray(parsed.sections) ? parsed.sections.slice(0, 10) : [];
    if (!sections.length) throw new Error("Couldn't build notes from this file. Try again.");
    let html = parsed.summary ? `<p><em>${esc(parsed.summary)}</em></p>` : "";
    for (const sec of sections) {
      html += `<h2>${esc(sec.heading)}</h2>`;
      const pts = Array.isArray(sec.points) ? sec.points.slice(0, 10) : [];
      if (pts.length) html += `<ul>${pts.map((p: unknown) => `<li>${esc(p)}</li>`).join("")}</ul>`;
      const terms = Array.isArray(sec.terms) ? sec.terms.slice(0, 8) : [];
      if (terms.length) html += `<p>${terms.map((t: { term?: string; definition?: string }) => `<strong>${esc(t.term)}</strong>: ${esc(t.definition)}`).join("<br>")}</p>`;
    }
    html += `<p><em>Generated from ${esc(fileName)}. Check anything important against the original.</em></p>`;
    const title = String(parsed.title || fileName.replace(/\.[^.]+$/, "")).slice(0, 120);
    const nbId = await notebookIdForName(supabase, spaceId, user.id, notebook);
    const { data, error } = await supabase.from("notes").insert({ space_id: spaceId, folder: notebook, ...(nbId ? { notebook_id: nbId } : {}), title, body: html, created_by: user.id }).select("id").single();
    if (error) return { error: error.message };
    try { await reindexSource(supabase, spaceId, "note", data.id, title, noteText(html)); } catch { /* best-effort */ }
    revalidatePath(`/spaces/${spaceId}/notes`);
    return { id: data.id as string, title };
  } catch (e) {
    return { error: friendlyError(e, "make notes from this file") };
  }
}


// Personal cover colour for a space (each member chooses their own).
export async function setSpaceCover(spaceId: string, color: string) {
  const { supabase, user } = await authed();
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { error: "Pick one of the colours." };
  const { error } = await supabase.from("space_prefs").upsert({ user_id: user.id, space_id: spaceId, cover_color: color, updated_at: new Date().toISOString() });
  if (error) return { error: /space_prefs/.test(error.message) ? "Cover colours need a database update. Run supabase/migration-21-space-prefs.sql." : error.message };
  revalidatePath("/spaces");
  return {};
}
