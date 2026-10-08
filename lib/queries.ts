import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Space, Deck, DueCard, CardReview } from "@/lib/types";
import { masteryFromStability } from "@/lib/scheduler";

// All spaces I'm a member of (RLS returns only those).
export async function getMySpaces(): Promise<Space[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("spaces").select("*").order("created_at");
  return (data as Space[]) ?? [];
}

// Wrapped in React's cache() because both the space layout and every page beneath it
// call getSpace(id) independently — without this, every navigation hit Supabase twice
// for the exact same row. cache() memoizes per-request, so the second call is free.
export const getSpace = cache(async (spaceId: string): Promise<Space | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from("spaces").select("*").eq("id", spaceId).single();
  return (data as Space) ?? null;
});

export async function getDecks(spaceId: string): Promise<Deck[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("active_recall_decks")
    .select("*")
    .eq("space_id", spaceId)
    .order("created_at");
  return (data as Deck[]) ?? [];
}

export async function getDeck(deckId: string): Promise<Deck | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("active_recall_decks")
    .select("*")
    .eq("deck_id", deckId)
    .single();
  return (data as Deck) ?? null;
}

// Merge shared card content with THIS user's personal FSRS review schedule.
// New cards (no review row yet) count as due now, at zero stability.
export async function getSpaceStudyData(spaceId: string) {
  const supabase = await createClient();
  const decks = await getDecks(spaceId);

  const { data: reviewRows } = await supabase
    .from("card_reviews")
    .select("card_id, stability, difficulty, scheduled_days, reps, lapses, state, due, last_review")
    .eq("space_id", spaceId);

  const reviews = new Map<string, CardReview>();
  (reviewRows as CardReview[] | null)?.forEach((r) => reviews.set(r.card_id, r));

  const now = Date.now();
  const due: DueCard[] = [];
  const perDeck: Record<string, { total: number; due: number; mastery: number }> = {};

  for (const deck of decks) {
    const cards = deck.cards_json ?? [];
    let stabilitySum = 0;
    let dueCount = 0;
    for (const c of cards) {
      const r = reviews.get(c.id);
      const dueMs = r ? new Date(r.due).getTime() : now;
      const stability = r?.stability ?? 0;
      stabilitySum += masteryFromStability(stability);
      if (dueMs <= now) {
        dueCount++;
        due.push({ ...c, deckId: deck.deck_id, deckTitle: deck.title, stability, dueMs });
      }
    }
    perDeck[deck.deck_id] = {
      total: cards.length,
      due: dueCount,
      mastery: cards.length ? stabilitySum / cards.length : 0,
    };
  }

  due.sort((a, b) => a.dueMs - b.dueMs);
  return { decks, due, perDeck };
}

// A single deck's cards merged with this user's FSRS state, due cards first.
export async function getDeckStudyData(spaceId: string, deckId: string) {
  const supabase = await createClient();
  const deck = await getDeck(deckId);
  if (!deck) return null;

  const { data: reviewRows } = await supabase
    .from("card_reviews")
    .select("card_id, stability, difficulty, scheduled_days, reps, lapses, state, due, last_review")
    .eq("space_id", spaceId)
    .in("card_id", (deck.cards_json ?? []).map((c) => c.id));

  const reviews = new Map<string, CardReview>();
  (reviewRows as CardReview[] | null)?.forEach((r) => reviews.set(r.card_id, r));

  const now = Date.now();
  const cards: DueCard[] = (deck.cards_json ?? []).map((c) => {
    const r = reviews.get(c.id);
    return { ...c, deckId: deck.deck_id, deckTitle: deck.title, stability: r?.stability ?? 0, dueMs: r ? new Date(r.due).getTime() : now };
  });
  cards.sort((a, b) => a.dueMs - b.dueMs);

  return { deck, cards, dueNow: cards.filter((c) => c.dueMs <= now) };
}

export async function getNotes(spaceId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes")
    .select("id, folder, title, body, updated_at, notebook_id, cover_kind, cover_value")
    .eq("space_id", spaceId)
    .order("updated_at", { ascending: false });
  if (!error) return data ?? [];
  // Migration 26 not run yet: fall back to the old columns so the page still works.
  const { data: old } = await supabase
    .from("notes")
    .select("id, folder, title, body, updated_at")
    .eq("space_id", spaceId)
    .order("updated_at", { ascending: false });
  return (old ?? []).map((n) => ({ ...n, notebook_id: null, cover_kind: null, cover_value: null }));
}

export async function getNotebooks(spaceId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notebooks")
    .select("id, name, cover_kind, cover_value, icon, sort")
    .eq("space_id", spaceId)
    .order("sort", { ascending: true })
    .order("created_at", { ascending: true });
  return error ? { rows: [], ready: false } : { rows: data ?? [], ready: true };
}

export async function getFiles(spaceId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("files")
    .select("id, folder, name, path, size_bytes, mime_type, created_at")
    .eq("space_id", spaceId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function getLectures(spaceId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lectures_audio")
    .select("id, title, audio_path, transcript, status, created_at")
    .eq("space_id", spaceId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function getMindmaps(spaceId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("mindmaps").select("*").eq("space_id", spaceId).order("created_at", { ascending: false });
  return data ?? [];
}

export async function getArticles(spaceId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("scholarly_articles")
    .select("*")
    .eq("space_id", spaceId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function getPastPapers(spaceId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("past_papers")
    .select("id, space_id, title, created_at")
    .eq("space_id", spaceId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function getPaperQuestions(paperId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("paper_questions")
    .select("id, paper_id, question_text, memo_answer, topic, difficulty")
    .eq("paper_id", paperId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

// This user's attempts across a space, newest first per question.
export async function getAttemptsForSpace(spaceId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("question_attempts")
    .select("id, question_id, student_answer, is_correct, feedback, created_at")
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function getFormulas(spaceId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("formulas")
    .select("id, space_id, label, latex, topic, created_at")
    .eq("space_id", spaceId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

// Study analytics: hours logged, cards reviewed, and per-topic accuracy from past-paper attempts.
export async function getStudyAnalytics(spaceId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: sessions }, { data: reviews }, { data: attempts }] = await Promise.all([
    supabase.from("focus_analytics").select("duration_minutes, created_at").eq("space_id", spaceId).eq("user_id", user.id),
    supabase.from("card_reviews").select("reps, lapses, stability").eq("space_id", spaceId).eq("user_id", user.id),
    supabase.from("question_attempts").select("is_correct, created_at, paper_questions(topic)").eq("space_id", spaceId).eq("user_id", user.id),
  ]);

  const totalMinutes = (sessions ?? []).reduce((s, r) => s + (r.duration_minutes ?? 0), 0);
  const cardsReviewed = (reviews ?? []).reduce((s, r) => s + (r.reps ?? 0), 0);
  const avgMastery = reviews && reviews.length ? reviews.reduce((s, r) => s + Math.min(1, (r.stability ?? 0) / 30), 0) / reviews.length : 0;

  const activeDays = new Set<string>();
  for (const s of sessions ?? []) activeDays.add(new Date(s.created_at).toDateString());
  for (const a of attempts ?? []) activeDays.add(new Date(a.created_at).toDateString());
  let streak = 0;
  for (let d = new Date(); ; d.setDate(d.getDate() - 1)) {
    if (activeDays.has(d.toDateString())) streak++;
    else break;
  }

  type AttemptRow = { is_correct: boolean; paper_questions: { topic: string | null } | null };
  const topicMap = new Map<string, { attempts: number; correct: number }>();
  for (const a of (attempts ?? []) as unknown as AttemptRow[]) {
    const topic = a.paper_questions?.topic ?? "Untagged";
    const t = topicMap.get(topic) ?? { attempts: 0, correct: 0 };
    t.attempts++;
    if (a.is_correct) t.correct++;
    topicMap.set(topic, t);
  }
  const topics = [...topicMap.entries()]
    .map(([topic, v]) => ({ topic, attempts: v.attempts, accuracy: v.correct / v.attempts }))
    .sort((a, b) => a.accuracy - b.accuracy);

  return { totalMinutes, cardsReviewed, avgMastery, streak, topics };
}
export async function getPainPoints(spaceId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("pain_points")
    .select("id, title, description, topic, hits, source, resolved, updated_at")
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .order("hits", { ascending: false })
    .order("updated_at", { ascending: false });
  return data ?? [];
}

export type LibraryBook = { id: string; title: string; file_path?: string; size_bytes: number; page_count: number | null; last_page: number; created_at: string; opened_at: string | null; cover_path?: string | null; cover_url?: string | null; last_cfi?: string | null };

// Private bucket, so covers are served as short-lived signed URLs (one batched request).
export async function attachCovers<T extends { cover_path?: string | null }>(supabase: Awaited<ReturnType<typeof createClient>>, rows: T[]): Promise<(T & { cover_url: string | null })[]> {
  const paths = rows.map((r) => r.cover_path).filter(Boolean) as string[];
  if (!paths.length) return rows.map((r) => ({ ...r, cover_url: null }));
  const { data } = await supabase.storage.from("library").createSignedUrls(paths, 60 * 60);
  const byPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  return rows.map((r) => ({ ...r, cover_url: (r.cover_path && byPath.get(r.cover_path)) || null }));
}

export async function getLibraryBooks(): Promise<LibraryBook[]> {
  const supabase = await createClient();
  const cols = "id, title, file_path, size_bytes, page_count, last_page, created_at, opened_at";
  const q = (sel: string) => supabase.from("library_books").select(sel)
    .order("opened_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
  let { data, error } = await q(cols + ", cover_path");
  if (error) ({ data } = await q(cols)); // migration 14 not run yet
  return attachCovers(supabase, ((data ?? []) as unknown) as LibraryBook[]);
}

export async function getLibraryBook(bookId: string) {
  const supabase = await createClient();
  const [{ data: book }, { data: highlights }, { data: bookmarks }] = await Promise.all([
    supabase.from("library_books").select("*").eq("id", bookId).maybeSingle(),
    supabase.from("library_highlights").select("id, page, text, color, rects, note, created_at").eq("book_id", bookId).order("page").order("created_at"),
    supabase.from("library_bookmarks").select("id, page, label, created_at").eq("book_id", bookId).order("page"),
  ]);
  if (!book) return null;
  return { book: book as LibraryBook, highlights: highlights ?? [], bookmarks: bookmarks ?? [] };
}

// Everything the customisable dashboard can show. Each read is independent and tolerant of
// missing tables (a section just renders its empty state).
export async function getDashboardData(userId: string) {
  const supabase = await createClient();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const monthAgo = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const [books, pains, papers, focus, attempts, layout] = await Promise.all([
    supabase.from("library_books").select("*").not("opened_at", "is", null).order("opened_at", { ascending: false }).limit(4),
    supabase.from("pain_points").select("id, title, topic, hits, space_id").eq("user_id", userId).eq("resolved", false).order("hits", { ascending: false }).order("updated_at", { ascending: false }).limit(5),
    supabase.from("past_papers").select("id, title, space_id, created_at").order("created_at", { ascending: false }).limit(4),
    supabase.from("focus_analytics").select("duration_minutes, created_at").eq("user_id", userId).gte("created_at", monthAgo),
    supabase.from("question_attempts").select("is_correct, created_at").eq("user_id", userId).gte("created_at", monthAgo),
    supabase.from("profiles").select("dashboard_widgets").eq("id", userId).maybeSingle(),
  ]);

  const focusRows = (focus.data ?? []) as { duration_minutes: number | null; created_at: string }[];
  const attemptRows = (attempts.data ?? []) as { is_correct: boolean; created_at: string }[];
  const thisWeek = <T extends { created_at: string }>(rows: T[]) => rows.filter((r) => r.created_at >= weekAgo);
  const weekAttempts = thisWeek(attemptRows);

  const activeDays = new Set([...focusRows, ...attemptRows].map((r) => new Date(r.created_at).toDateString()));
  let streak = 0;
  for (const d = new Date(); activeDays.has(d.toDateString()); d.setDate(d.getDate() - 1)) streak++;

  return {
    books: await attachCovers(supabase, (books.data ?? []) as { id: string; title: string; page_count: number | null; last_page: number; opened_at: string; cover_path?: string | null }[]),
    pains: (pains.data ?? []) as { id: string; title: string; topic: string | null; hits: number; space_id: string }[],
    papers: (papers.data ?? []) as { id: string; title: string; space_id: string; created_at: string }[],
    week: {
      focusMinutes: thisWeek(focusRows).reduce((s, r) => s + (r.duration_minutes ?? 0), 0),
      answered: weekAttempts.length,
      accuracy: weekAttempts.length ? Math.round((weekAttempts.filter((a) => a.is_correct).length / weekAttempts.length) * 100) : null,
      streak,
    },
    layout: (layout.error ? null : (layout.data?.dashboard_widgets ?? null)) as { id: string; visible: boolean }[] | null,
    layoutSupported: !layout.error,
  };
}

// Per-space numbers for the dashboard cards: decks, cards due for this user, notes.
export async function getSpaceCovers(userId: string): Promise<Record<string, string>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("space_prefs").select("space_id, cover_color").eq("user_id", userId);
  if (error) return {};
  return Object.fromEntries(((data ?? []) as { space_id: string; cover_color: string | null }[]).filter((r) => r.cover_color).map((r) => [r.space_id, r.cover_color!]));
}

export async function getSpaceStats(userId: string, spaceIds: string[]) {
  const out: Record<string, { decks: number; cards: number; due: number; notes: number }> = {};
  if (!spaceIds.length) return out;
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const [decks, notes, notDue] = await Promise.all([
    supabase.from("active_recall_decks").select("space_id, cards_json").in("space_id", spaceIds),
    supabase.from("notes").select("space_id").in("space_id", spaceIds),
    supabase.from("card_reviews").select("space_id").eq("user_id", userId).in("space_id", spaceIds).gt("due", nowIso),
  ]);
  for (const id of spaceIds) out[id] = { decks: 0, cards: 0, due: 0, notes: 0 };
  for (const d of (decks.data ?? []) as { space_id: string; cards_json: unknown[] | null }[]) { out[d.space_id].decks++; out[d.space_id].cards += d.cards_json?.length ?? 0; }
  for (const n of (notes.data ?? []) as { space_id: string }[]) out[n.space_id].notes++;
  const scheduled: Record<string, number> = {};
  for (const r of (notDue.data ?? []) as { space_id: string }[]) scheduled[r.space_id] = (scheduled[r.space_id] ?? 0) + 1;
  // Cards never reviewed are due; reviewed ones are due unless scheduled for later.
  for (const id of spaceIds) out[id].due = Math.max(0, out[id].cards - (scheduled[id] ?? 0));
  return out;
}
