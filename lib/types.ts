export type SpaceType = "peer" | "teacher_hub";
export type MemberRole = "admin" | "member" | "instructor";
export type Rating = "got" | "fuzzy" | "missed";

export interface Space {
  id: string;
  name: string;
  subject: string | null;
  type: SpaceType;
  invite_code: string;
  created_by: string;
  created_at: string;
  // Added by migration 22 (absent until it has been run).
  is_public?: boolean;
  public_description?: string | null;
}

// A card's shared *content* (lives in active_recall_decks.cards_json). No answer field, by design —
// except cards made from a note highlight, where the highlighted text IS the answer and is kept
// for context when you jump back to the source note.
export interface Card {
  id: string;
  concept: string;
  question: string;
  hint: string;
  answer?: string;
  sourceNoteId?: string;
}

export interface Deck {
  deck_id: string;
  space_id: string;
  title: string;
  subject: string | null;
  cards_json: Card[];
  front_language?: string;
  back_language?: string;
}

// A user's *personal* review schedule for one card (lives in card_reviews), FSRS state.
export interface CardReview {
  card_id: string;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;
  due: string; // ISO timestamp
  last_review: string | null;
}

// A card ready to study: content + this user's schedule, flattened.
export interface DueCard extends Card {
  deckId: string;
  deckTitle: string;
  stability: number;
  dueMs: number;
}

export type Difficulty = "easy" | "medium" | "hard";

export interface PastPaper {
  id: string;
  space_id: string;
  title: string;
  created_at: string;
}

export interface PaperQuestion {
  id: string;
  paper_id: string;
  question_text: string;
  memo_answer: string;
  topic: string | null;
  difficulty: Difficulty;
}

export interface QuestionAttempt {
  id: string;
  question_id: string;
  student_answer: string;
  is_correct: boolean;
  feedback: string;
  created_at: string;
}

export interface Formula {
  id: string;
  space_id: string;
  label: string;
  latex: string;
  topic: string | null;
  created_at: string;
}
