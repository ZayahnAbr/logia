"use server";

import { revalidatePath } from "next/cache";
import { callAudio, callVision } from "@/lib/server/aiRoute";
import { authed, enforceRateLimit, friendlyError, groqChat, isUnmetered } from "@/lib/server/llm";
import type { Card } from "@/lib/types";

const deckPath = (spaceId: string, deckId?: string) => (deckId ? `/spaces/${spaceId}/decks/${deckId}` : `/spaces/${spaceId}`);

async function readCards(deckId: string) {
  const { supabase, user } = await authed();
  const { data, error } = await supabase.from("active_recall_decks").select("cards_json").eq("deck_id", deckId).single();
  if (error || !data) throw new Error("That deck no longer exists.");
  return { supabase, user, cards: ((data.cards_json as Card[]) ?? []) };
}

// ── Organise sets ────────────────────────────────────────────────────────────

export async function renameDeck(spaceId: string, deckId: string, title: string) {
  const clean = title.trim().slice(0, 160);
  if (!clean) return { error: "The deck name can't be empty." };
  const { supabase } = await authed();
  const { error } = await supabase.from("active_recall_decks").update({ title: clean }).eq("deck_id", deckId);
  if (error) return { error: friendlyError(error, "rename this deck") };
  revalidatePath(deckPath(spaceId)); revalidatePath(deckPath(spaceId, deckId));
  return {};
}

// Folders reuse the deck's existing `subject` field, so no migration is needed.
export async function setDeckFolder(spaceId: string, deckId: string, folder: string) {
  const { supabase } = await authed();
  const { error } = await supabase.from("active_recall_decks").update({ subject: folder.trim().slice(0, 80) || null }).eq("deck_id", deckId);
  if (error) return { error: friendlyError(error, "move this deck") };
  revalidatePath(deckPath(spaceId));
  return {};
}

export async function deleteDeck(spaceId: string, deckId: string) {
  const { supabase } = await authed();
  const { error } = await supabase.from("active_recall_decks").delete().eq("deck_id", deckId);
  if (error) return { error: friendlyError(error, "delete this deck") };
  revalidatePath(deckPath(spaceId));
  return {};
}

// ── Edit cards ───────────────────────────────────────────────────────────────

export type CardInput = { id?: string; concept: string; question: string; answer: string; hint: string };

export async function saveCard(spaceId: string, deckId: string, input: CardInput) {
  try {
    const question = input.question.trim();
    if (!question) return { error: "A card needs a question." };
    const { supabase, cards } = await readCards(deckId);
    const card: Card = {
      id: input.id ?? crypto.randomUUID(),
      concept: input.concept.trim().slice(0, 120),
      question: question.slice(0, 1000),
      answer: input.answer.trim().slice(0, 2000) || undefined,
      hint: input.hint.trim().slice(0, 500),
    };
    const i = cards.findIndex((c) => c.id === card.id);
    const next = i >= 0 ? cards.map((c, j) => (j === i ? { ...c, ...card } : c)) : [...cards, card];
    const { error } = await supabase.from("active_recall_decks").update({ cards_json: next }).eq("deck_id", deckId);
    if (error) throw error;
    revalidatePath(deckPath(spaceId, deckId));
    return { card };
  } catch (e) {
    return { error: friendlyError(e, "save this card") };
  }
}

export async function removeCard(spaceId: string, deckId: string, cardId: string) {
  try {
    const { supabase, cards } = await readCards(deckId);
    const { error } = await supabase.from("active_recall_decks").update({ cards_json: cards.filter((c) => c.id !== cardId) }).eq("deck_id", deckId);
    if (error) throw error;
    await supabase.from("card_reviews").delete().eq("card_id", cardId);
    revalidatePath(deckPath(spaceId, deckId));
    return {};
  } catch (e) {
    return { error: friendlyError(e, "delete this card") };
  }
}

// ── Answer input: speech and handwriting ────────────────────────────────────

// Spoken answer → text (Groq Whisper). Audio arrives as a form file from MediaRecorder.
export async function transcribeAnswer(form: FormData) {
  try {
    const { supabase, user } = await authed();
    const plan = (await enforceRateLimit(supabase, user)) ?? "free";
    const audio = form.get("audio");
    if (!(audio instanceof Blob) || audio.size === 0) return { error: "No audio was recorded. Hold the button while you speak." };
    if (audio.size > 10 * 1024 * 1024) return { error: "That recording is too long. Keep spoken answers under about 2 minutes." };
    const { text: raw } = await callAudio({ file: audio, filename: "answer.webm", purpose: "interactive", task: "transcribe an answer", supabase, userId: user.id, unmetered: isUnmetered(user.email), plan });
    const text = raw.trim();
    if (!text) return { error: "Couldn't hear any words. Try again a little closer to the microphone." };
    return { text };
  } catch (e) {
    return { error: friendlyError(e, "transcribe your answer") };
  }
}

// Handwritten answer (canvas PNG) → text, via the vision model.
export async function readHandwriting(imageDataUrl: string) {
  try {
    const { supabase, user } = await authed();
    const plan = (await enforceRateLimit(supabase, user)) ?? "free";
    if (!imageDataUrl.startsWith("data:image/")) return { error: "Nothing was written yet." };
    const { content: text } = await callVision({
      purpose: "interactive", imageDataUrls: [imageDataUrl], maxTokens: 600, task: "read handwriting",
      text: "Transcribe this handwritten answer exactly. Write any maths as plain text. Output only the transcription, nothing else.",
      supabase, userId: user.id, unmetered: isUnmetered(user.email), plan,
    });
    if (!text) return { error: "Couldn't read the writing. Try writing a little larger." };
    return { text };
  } catch (e) {
    return { error: friendlyError(e, "read your handwriting") };
  }
}

// ── Recall check ─────────────────────────────────────────────────────────────

export type RecallResult = {
  score: number;
  verdict: "strong" | "partial" | "weak";
  included: string[];
  missed: string[];
  incorrect: string[];
  tip: string;
  modelAnswer: string;
};

const RECALL_SYSTEM = `You check a student's recall of a flashcard like a strict but fair university marker. Paraphrases count: judge meaning, not exact wording.
SPELLING depends on ANSWER SOURCE (given below):
- typed or handwritten: KEY TERMS must be spelled correctly (names, technical/subject terms, keywords from the model answer). A misspelled key term does NOT count as covered: put it in "incorrect" as 'Spelling: "<what they wrote>" → <correct spelling>' and lower the score. Ignore small typos in ordinary everyday words.
- spoken: the text is a speech transcript, so never penalise spelling.
Steps: identify the 2-6 key ideas a complete answer needs (from the MODEL ANSWER; if it is empty, write a concise, accurate model answer first). Then compare the STUDENT ANSWER against them.
Return ONLY valid JSON in exactly this shape:
{ "model_answer": "2-4 sentence complete answer", "score": 0-100, "verdict": "strong" | "partial" | "weak",
  "included": ["key idea the student covered, 2-8 words", ...], "missed": ["key idea they left out, 2-8 words", ...],
  "incorrect": ["anything they stated that is wrong, 2-10 words", ...], "tip": "one short sentence on what to focus on next" }
Rules: score = share of key ideas correctly covered, reduced for wrong statements. strong ≥ 80, partial 50-79, weak < 50.
If the student says they don't know or answers off-topic, score 0 and list every key idea as missed.`;

export async function checkRecall(spaceId: string, deckId: string, cardId: string, studentAnswer: string, source: "typed" | "handwritten" | "spoken" = "typed") {
  const answer = studentAnswer.trim();
  if (!answer) return { error: "Give an answer first. Speak, type or write it." };
  try {
    const { supabase, cards } = await readCards(deckId);
    const card = cards.find((c) => c.id === cardId);
    if (!card) return { error: "That card no longer exists." };

    const parsed = await groqChat(
      RECALL_SYSTEM,
      `ANSWER SOURCE: ${source}\nCONCEPT: ${card.concept}\nQUESTION: ${card.question}\nHINT: ${card.hint}\nMODEL ANSWER: ${card.answer ?? ""}\n\nSTUDENT ANSWER:\n${answer.slice(0, 2500)}`,
      900,
    );
    const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 120)).filter(Boolean).slice(0, 8) : []);
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
    const modelAnswer = String(card.answer || parsed.model_answer || "").slice(0, 2000);
    const result: RecallResult = {
      score,
      verdict: score >= 80 ? "strong" : score >= 50 ? "partial" : "weak",
      included: list(parsed.included), missed: list(parsed.missed), incorrect: list(parsed.incorrect),
      tip: String(parsed.tip ?? "").slice(0, 240),
      modelAnswer,
    };

    // Cards made without an answer get the generated one saved, so every later check
    // is marked against the same reference.
    if (!card.answer && modelAnswer) {
      await supabase.from("active_recall_decks")
        .update({ cards_json: cards.map((c) => (c.id === cardId ? { ...c, answer: modelAnswer } : c)) })
        .eq("deck_id", deckId);
      revalidatePath(deckPath(spaceId, deckId));
    }
    return { result };
  } catch (e) {
    return { error: friendlyError(e, "check your answer") };
  }
}
