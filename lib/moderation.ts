// Small chat filter. Used on the client (instant feedback) and again in the server action.
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };
// Whole-word matches (with common suffixes), so "class" and "assess" are fine.
const EXACT = ["shit", "bitch", "bastard", "asshole", "dick", "dickhead", "piss", "slut", "whore", "retard", "kys", "twat", "wanker", "cock", "prick"];
// Matches at the start of a word, for stems with no innocent words.
const STEMS = ["fuck", "nigger", "nigga", "faggot", "cunt", "motherfuck", "bullshit"];
const SUFFIX = "(s|es|ed|er|ers|ing|y|ie|head)?";
const squash = (s: string) => s.replace(/(.)\1+/g, "$1");
const EXACT_RE = new RegExp(`^(${EXACT.map(squash).join("|")})${SUFFIX}$`);
const STEMS_SQ = STEMS.map(squash);

function norm(word: string) {
  return squash(word.toLowerCase().replace(/[0134578@$!]/g, (c) => LEET[c] ?? c).replace(/[^a-z]/g, ""));
}

export function hasBlockedWord(text: string): boolean {
  const raw = text.split(/\s+/).filter(Boolean);
  // Join runs of single letters ("f u c k") before checking.
  const words: string[] = [];
  let run = "";
  for (const w of raw) {
    if (w.replace(/[^a-z0-9@$!]/gi, "").length === 1) { run += w; continue; }
    if (run.length > 2) words.push(run);
    run = "";
    words.push(w);
  }
  if (run.length > 2) words.push(run);
  return words.some((w) => {
    const n = norm(w);
    return !!n && (EXACT_RE.test(n) || STEMS_SQ.some((s) => n.startsWith(s)));
  });
}

const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|me|ly|gg|tv|app|dev|xyz|info|link|za|uk|ai)\b(?:\/\S*)?/gi;
export const stripLinks = (text: string) => text.replace(URL_RE, "[link removed]");

export const MAX_CHAT = 280;

export function cleanChatMessage(input: string): { ok: true; body: string } | { ok: false; error: string } {
  const body = stripLinks(input.replace(/\s+/g, " ").trim());
  if (!body) return { ok: false, error: "Write something first." };
  if (body.length > MAX_CHAT) return { ok: false, error: `Keep it under ${MAX_CHAT} characters.` };
  if (hasBlockedWord(body)) return { ok: false, error: "Let's keep the café friendly. Please reword that message." };
  return { ok: true, body };
}
