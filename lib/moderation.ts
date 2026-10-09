// Word filter for everything people can read from each other: chat, display names, room goals,
// hosted room names and descriptions, public space names and descriptions.
// Used in the browser (so nothing is sent), again in server actions, and finally by the database
// (blocked_terms + triggers in supabase/migration-41-content-safety.sql) so a modified client cannot get around it.
//
// Layers:
//  1. The `obscenity` package (MIT) for English: handles leetspeak, look-alike characters, spacing and repeats,
//     with word-boundary matching so ordinary words such as "class" or "Scunthorpe" are left alone.
//  2. BLOCKED_WORDS below: our own list (English extras, South African languages, racial slurs), matched as
//     whole words after normalising (lower case, accents removed, leetspeak, repeated letters collapsed).
//     The same list seeds the database table blocked_terms. Keep the two in step.
//  3. ALLOW_WORDS: ordinary words that must never be blocked.
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from "obscenity";

export type TermMode = "word" | "stem" | "exact";
export type BlockedTerm = { term: string; mode: TermMode };

// REVIEW NEEDED: the Afrikaans, isiZulu, isiXhosa and Sesotho entries below were compiled without a native-speaker
// review. They must be checked by native speakers before relying on them: some entries may be missing, a word may be
// harmless in a dialect, and spelling varies. Edit the list here and in the blocked_terms table (admins can change the
// table at any time without a deploy).
//   "word"  whole word, repeated letters collapsed ("fuuuck" matches "fuck"), with common suffixes (s, ing, er ...)
//   "exact" whole word, spelt as written (used where collapsing letters would collide with an ordinary word)
//   "stem"  any word starting with it (only for stems that have no innocent words)
export const BLOCKED_WORDS: BlockedTerm[] = [
  // English (extras on top of obscenity)
  { term: "shit", mode: "word" }, { term: "bitch", mode: "word" }, { term: "bastard", mode: "word" }, { term: "asshole", mode: "word" },
  { term: "dick", mode: "word" }, { term: "dickhead", mode: "word" }, { term: "piss", mode: "exact" }, { term: "slut", mode: "word" },
  { term: "whore", mode: "word" }, { term: "retard", mode: "word" }, { term: "kys", mode: "exact" }, { term: "twat", mode: "word" },
  { term: "wanker", mode: "word" }, { term: "cock", mode: "exact" }, { term: "prick", mode: "word" },
  { term: "fuck", mode: "stem" }, { term: "motherfuck", mode: "stem" }, { term: "bullshit", mode: "stem" }, { term: "cunt", mode: "stem" },
  // Racial and homophobic slurs (English and South African)
  { term: "nigger", mode: "stem" }, { term: "nigga", mode: "stem" }, { term: "faggot", mode: "stem" },
  { term: "kaffir", mode: "word" }, { term: "kaffer", mode: "word" }, { term: "hotnot", mode: "word" }, { term: "coolie", mode: "word" },
  { term: "koelie", mode: "word" }, { term: "houtkop", mode: "word" }, { term: "boesman", mode: "word" }, { term: "isitabane", mode: "word" },
  // Afrikaans
  { term: "poes", mode: "exact" }, { term: "naai", mode: "exact" }, { term: "fok", mode: "exact" }, { term: "fokken", mode: "exact" },
  { term: "fokof", mode: "exact" }, { term: "doos", mode: "exact" }, { term: "hoer", mode: "exact" }, { term: "piel", mode: "exact" },
  { term: "kont", mode: "exact" }, { term: "kak", mode: "exact" }, { term: "teef", mode: "exact" },
  // isiZulu and isiXhosa
  { term: "isifebe", mode: "word" }, { term: "ikhaba", mode: "word" }, { term: "umthondo", mode: "word" }, { term: "isidwedwe", mode: "word" },
  { term: "sfebe", mode: "exact" },
  // Sesotho and Setswana
  { term: "sethotsela", mode: "word" }, { term: "mmago", mode: "exact" },
];
// Left out on purpose: everyday words such as "bliksem" and "tsotsi", which are common in ordinary speech.

// Ordinary words that contain or resemble blocked ones. They are never flagged.
export const ALLOW_WORDS = new Set([
  "scunthorpe", "assess", "assessment", "assessments", "assassin", "class", "classic", "classes", "grass", "bass", "mass", "pass", "passage",
  "analysis", "analyst", "analyse", "cockatoo", "cocktail", "peacock", "hancock", "shitake", "shiitake", "dickens", "dickinson", "title", "titles",
  "basement", "document", "therapist", "therapists", "arsenal", "cocoa", "essex", "middlesex", "sussex", "wessex", "penistone", "lightwater",
  "button", "buttons", "butter", "skills", "skill", "kakapo", "kakadu", "kakao", "dosage", "doosan",
]);

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };
const SUFFIX = "(s|es|ed|er|ers|ing|y|ie|head)?";
export const squash = (s: string) => s.replace(/(.)\1+/g, "$1");

/** Lower case, accents removed, leetspeak undone. Letters only come out; everything else becomes a space. */
export function normaliseForFilter(text: string): string {
  return text
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[0134578@$!]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z]+/g, " ")
    .trim();
}

const WORD_RE = BLOCKED_WORDS.filter((t) => t.mode === "word").map((t) => squash(t.term));
const WORD_MATCH = new RegExp(`^(${WORD_RE.join("|")})${SUFFIX}$`);
const EXACT = new Set(BLOCKED_WORDS.filter((t) => t.mode === "exact").map((t) => t.term));
const STEMS = BLOCKED_WORDS.filter((t) => t.mode === "stem").map((t) => squash(t.term));

function ownListHit(tokens: string[]): boolean {
  return tokens.some((tok) => {
    if (ALLOW_WORDS.has(tok)) return false;
    const sq = squash(tok);
    return EXACT.has(tok) || WORD_MATCH.test(sq) || STEMS.some((s) => sq.startsWith(s));
  });
}

const englishMatcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

function englishHit(text: string): boolean {
  if (!englishMatcher.hasMatch(text)) return false;
  // Ignore a match that sits inside an allowed ordinary word.
  for (const m of englishMatcher.getAllMatches(text)) {
    let s = m.startIndex, e = m.endIndex + 1;
    while (s > 0 && /[\p{L}]/u.test(text[s - 1])) s--;
    while (e < text.length && /[\p{L}]/u.test(text[e])) e++;
    const word = text.slice(s, e).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (!ALLOW_WORDS.has(word)) return true;
  }
  return false;
}

/** Runs of single letters ("f u c k", "f.u.c.k") joined so they are checked as one word. */
function joinedRuns(tokens: string[]): string[] {
  const out: string[] = [];
  let run = "";
  for (const w of tokens) {
    if (w.length === 1) { run += w; continue; }
    if (run.length > 2) out.push(run);
    run = "";
  }
  if (run.length > 2) out.push(run);
  return out;
}

export function hasBlockedWord(text: string): boolean {
  if (!text) return false;
  if (englishHit(text)) return true;
  const tokens = normaliseForFilter(text).split(" ").filter(Boolean);
  if (ownListHit(tokens)) return true;
  return ownListHit(joinedRuns(tokens));
}

/** Which of several texts are blocked (for the scan before a space goes public). */
export const firstBlocked = (texts: string[]) => texts.find((t) => hasBlockedWord(t));

/** The only thing a person is ever told when their text is blocked (shown quietly, never as an alert). */
export const NOT_SENT_NOTE = "That message wasn't sent.";

/** Remote text (a name or goal arriving over a realtime channel) that must not be displayed. */
export const safeRemoteText = (text: string | null | undefined, fallback = "") => (text && hasBlockedWord(text) ? fallback : text ?? fallback);

/** True when an error from the database or a server action means "blocked by the word filter". */
export const isBlockedError = (message?: string | null) => !!message && /blocked_text/.test(message);

const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|me|ly|gg|tv|app|dev|xyz|info|link|za|uk|ai)\b(?:\/\S*)?/gi;
export const stripLinks = (text: string) => text.replace(URL_RE, "[link removed]");

export const MAX_CHAT = 280;

export function cleanChatMessage(input: string): { ok: true; body: string } | { ok: false; error: string; blocked?: boolean } {
  const body = stripLinks(input.replace(/\s+/g, " ").trim());
  if (!body) return { ok: false, error: "Write something first." };
  if (body.length > MAX_CHAT) return { ok: false, error: `Keep it under ${MAX_CHAT} characters.` };
  if (hasBlockedWord(body)) return { ok: false, error: NOT_SENT_NOTE, blocked: true };
  return { ok: true, body };
}
