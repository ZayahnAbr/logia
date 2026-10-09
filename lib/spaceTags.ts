// Tags, level and school for public spaces (migration 41). Plain module so server and client can both import it.
export const SUBJECT_TAGS = ["maths", "physics", "chemistry", "biology", "accounting", "economics", "law", "computer science", "psychology", "statistics", "engineering", "history", "languages"];
export const FORMAT_TAGS = ["exam prep", "notes", "flashcards", "past paper practice", "study group"];
export const LEVELS = ["high school", "first year", "second year", "third year", "honours", "postgrad", "other"] as const;
export type SpaceLevel = (typeof LEVELS)[number];
export const MAX_TAGS = 6;

const TAG_RE = /^[a-z0-9][a-z0-9 -]{0,22}[a-z0-9]$/;

/** Lower case, trimmed, one space between words; keeps only valid tags (2 to 24 characters), no duplicates, at most 6. */
export function normaliseTags(input: string[]): string[] {
  const out: string[] = [];
  for (const raw of input) {
    const t = raw.toLowerCase().replace(/[^a-z0-9 -]+/g, " ").replace(/\s+/g, " ").trim();
    if (TAG_RE.test(t) && !out.includes(t)) out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
export const isLevel = (v: string | null | undefined): v is SpaceLevel => !!v && (LEVELS as readonly string[]).includes(v);
