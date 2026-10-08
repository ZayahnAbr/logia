// Deck language tags (ISO 639-1) → BCP-47 locale used by the browser's speech synthesis.
export const LANGUAGES: { code: string; label: string; locale: string }[] = [
  { code: "en", label: "English", locale: "en-ZA" },
  { code: "af", label: "Afrikaans", locale: "af-ZA" },
  { code: "zu", label: "isiZulu", locale: "zu-ZA" },
  { code: "xh", label: "isiXhosa", locale: "xh-ZA" },
  { code: "st", label: "Sesotho", locale: "st-ZA" },
  { code: "fr", label: "French", locale: "fr-FR" },
  { code: "es", label: "Spanish", locale: "es-ES" },
  { code: "de", label: "German", locale: "de-DE" },
  { code: "pt", label: "Portuguese", locale: "pt-PT" },
];

export function localeFor(code?: string) {
  return LANGUAGES.find((l) => l.code === code)?.locale ?? "en-ZA";
}

// Picks the closest installed voice for the locale; falls back to the browser default.
export function speak(text: string, code?: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const locale = localeFor(code);
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = locale;
  const voices = window.speechSynthesis.getVoices();
  utter.voice = voices.find((v) => v.lang === locale) ?? voices.find((v) => v.lang.startsWith(locale.slice(0, 2))) ?? null;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}
