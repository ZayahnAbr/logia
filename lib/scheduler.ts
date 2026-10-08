import { createEmptyCard, fsrs, FSRS, Rating as FsrsRating, State, type Card as FsrsCard, type Grade } from "ts-fsrs";
import type { Rating } from "./types";

const f: FSRS = fsrs();

// Our 3-button self-report maps onto FSRS's 4-grade scale (Easy is unused — no UI for it).
const RATING_MAP: Record<Rating, Grade> = {
  missed: FsrsRating.Again as Grade,
  fuzzy: FsrsRating.Hard as Grade,
  got: FsrsRating.Good as Grade,
};

// The subset of FSRS Card fields we persist in card_reviews (DB row <-> ts-fsrs Card).
export type FsrsState = {
  due: string; // ISO timestamp
  stability: number;
  difficulty: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number; // ts-fsrs State enum
  last_review: string | null;
};

function toFsrsCard(prev: FsrsState | null): FsrsCard {
  if (!prev) return createEmptyCard();
  return {
    due: new Date(prev.due),
    stability: prev.stability,
    difficulty: prev.difficulty,
    elapsed_days: 0,
    scheduled_days: prev.scheduled_days,
    learning_steps: 0,
    reps: prev.reps,
    lapses: prev.lapses,
    state: prev.state as State,
    last_review: prev.last_review ? new Date(prev.last_review) : undefined,
  };
}

// Pure: given a card's current FSRS state and a self-rating, return the next state.
export function nextSchedule(prev: FsrsState | null, rating: Rating): FsrsState {
  const card = toFsrsCard(prev);
  const now = new Date();
  const grade = RATING_MAP[rating];
  const { card: next } = f.next(card, now, grade);
  return {
    due: next.due.toISOString(),
    stability: next.stability,
    difficulty: next.difficulty,
    scheduled_days: next.scheduled_days,
    reps: next.reps,
    lapses: next.lapses,
    state: next.state as number,
    last_review: next.last_review ? next.last_review.toISOString() : now.toISOString(),
  };
}

// 0 (New) .. ~1 (mastered) — used for the mastery stat, derived from stability rather than a fixed ladder.
export function masteryFromStability(stability: number) {
  return Math.min(1, stability / 30);
}
