// Sense checks for speech-to-text output, shared by the landing-page trial and the lectures transcriber.

// Whisper invents text on silence, music or noise: stock phrases ("Thanks for watching"), or one phrase
// looping over and over. These checks catch those cases without a second AI call. Returns a message
// for the visitor when the transcript isn't trustworthy, or null when it looks like real speech.
const HALLUCINATIONS = [
  /thanks? for watching/i, /thank you for watching/i, /please subscribe/i, /like and subscribe/i,
  /subtitles? by/i, /amara\.org/i, /transcribed by/i, /see you (in the )?next (time|video)/i,
];
export function transcriptProblem(transcript: string): string | null {
  const unclear = "That recording didn't sound like clear speech, so the transcript wouldn't be reliable. Try a clearer clip.";
  const words = transcript.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  if (words.length < 4) return unclear;
  // Short output that is only a stock phrase = hallucinated from silence or noise.
  if (words.length < 25 && HALLUCINATIONS.some((re) => re.test(transcript))) return unclear;
  // Very few distinct words across a long transcript = a looping hallucination.
  if (words.length >= 20 && new Set(words).size / words.length < 0.2) return unclear;
  // The same sentence repeated back to back.
  const sentences = transcript.split(/(?<=[.!?。])\s+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  let run = 1;
  for (let i = 1; i < sentences.length; i++) {
    run = sentences[i] === sentences[i - 1] ? run + 1 : 1;
    if (run >= 4) return unclear;
  }
  // Mostly non-letter characters (music notes, symbols) = not speech.
  const letters = (transcript.match(/\p{L}/gu) ?? []).length;
  if (letters / transcript.length < 0.5) return unclear;
  return null;
}


export const COHERENCE_UNCLEAR = "That recording didn't come out as sentences that make sense. Try a clearer clip.";

/** A few snippets from the start, middle and end of a long transcript, for a cheap coherence judgement. */
export function transcriptSample(t: string, each = 1500): string {
  if (t.length <= each * 3) return t;
  const mid = Math.floor(t.length / 2 - each / 2);
  return [t.slice(0, each), t.slice(mid, mid + each), t.slice(-each)].join(" [...] ");
}
