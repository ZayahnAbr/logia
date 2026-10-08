"use client";

import { useState } from "react";
import { RotateCcw, Check, X as XIcon, Mic, Layers, Keyboard, Send } from "lucide-react";

// Middle of the landing page: a real, tappable flashcard. No scroll listeners —
// a CSS 3D flip (transform + opacity only) driven by click, Space or Enter.
const CARDS = [
  { q: "What does photosynthesis produce?", a: "Glucose (a sugar the plant uses for energy) and oxygen.", said: "“Sugar for the plant, and oxygen.”", score: 90, got: ["Glucose, the plant’s sugar", "Oxygen"], missed: [] as string[] },
  { q: "Where in a plant cell does photosynthesis happen?", a: "In the chloroplasts, which hold the green pigment chlorophyll.", said: "“In the chloroplasts.”", score: 70, got: ["In the chloroplasts"], missed: ["Chlorophyll is what captures the light"] },
  { q: "What does a plant need for photosynthesis?", a: "Sunlight, water and carbon dioxide from the air.", said: "“Sunlight and water.”", score: 60, got: ["Sunlight", "Water"], missed: ["Carbon dioxide from the air"] },
];

export function DemoDeck() {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState<number[]>([]);
  const [mode, setMode] = useState<"idle" | "listening" | "typing">("idle");
  const [typed, setTyped] = useState("");
  const [heard, setHeard] = useState<string | null>(null); // what the visitor "said" or typed, shown on the back

  // Demo only: speaking simulates a short recording, then reveals the recall check.
  const speak = () => {
    setMode("listening");
    setTimeout(() => { setHeard(null); setMode("idle"); setFlipped(true); }, 1600);
  };
  const submitTyped = (e: React.FormEvent) => {
    e.preventDefault();
    if (!typed.trim()) return;
    setHeard(`“${typed.trim()}”`); setTyped(""); setMode("idle"); setFlipped(true);
  };
  const card = CARDS[i];

  const next = (knewIt: boolean) => {
    setDone((d) => [...d, knewIt ? 1 : 0]);
    setFlipped(false); setHeard(null); setMode("idle");
    setTimeout(() => setI((n) => (n + 1) % CARDS.length), 180);
  };
  const restart = () => { setDone([]); setFlipped(false); setI(0); };
  const finished = done.length >= CARDS.length;

  return (
    <div className="demo">
      <div className="demo-copy">
        <p className="eyebrow" style={{ color: "var(--accent-text)" }}>Try it</p>
        <h2 className="l-h2">Your notes, turned into cards <em className="serif">that test you</em></h2>
        <p className="l-body">Logia writes questions from your notes, checks your answers, and brings each card back just before you'd forget it.</p>
        <ol className="demo-steps">
          <li><span>01</span> Write or scan your notes</li>
          <li><span>02</span> Generate flashcards in one click</li>
          <li><span>03</span> Answer out loud and see what you missed</li>
        </ol>
      </div>

      <div className="demo-deck">
        <div className="demo-meta" aria-live="polite">
          <span><Layers size={13} aria-hidden="true" /> Biology · Photosynthesis</span>
          <span>{finished ? "Done" : `${i + 1} of ${CARDS.length}`}</span>
        </div>

        {finished ? (
          <div className="demo-card demo-done">
            <strong style={{ fontSize: 20 }}>Session complete</strong>
            <span style={{ color: "var(--muted)", fontSize: 14 }}>{done.filter(Boolean).length} of {CARDS.length} remembered. The rest come back sooner.</span>
            <button type="button" className="btn" onClick={restart}><RotateCcw size={14} aria-hidden="true" /> Go again</button>
          </div>
        ) : (
          <div className="demo-stack">
            <span className="demo-behind" aria-hidden="true" />
            <span className="demo-behind two" aria-hidden="true" />
            <button type="button" className={`demo-card${flipped ? " is-flipped" : ""}`} onClick={() => setFlipped((f) => !f)}
              aria-label={flipped ? `Answer: ${card.a}. Tap to see the question` : `Question: ${card.q}. Tap to reveal the answer`}>
              <span className="demo-face demo-front">
                <span className="demo-tag">Question</span>
                <strong>{card.q}</strong>
                <span className="demo-hint">Answer below, or tap to flip</span>
              </span>
              <span className="demo-face demo-back">
                <span className="demo-tag">Answer</span>
                <strong>{card.a}</strong>
                <span className="demo-said">{heard ? <Keyboard size={13} aria-hidden="true" /> : <Mic size={13} aria-hidden="true" />} {heard ?? card.said}</span>
                <span className="demo-score"><b>{card.score}%</b> recall</span>
                <span className="demo-rows">
                  {card.got.map((g) => <span key={g} className="ok"><Check size={12} aria-hidden="true" /> {g}</span>)}
                  {card.missed.map((m) => <span key={m} className="miss"><XIcon size={12} aria-hidden="true" /> Missed: {m}</span>)}
                </span>
              </span>
            </button>
          </div>
        )}

        {!finished && (
          <div className="demo-actions">
            {flipped ? (
              <>
                <button type="button" className="btn" onClick={() => next(false)}>Again</button>
                <button type="button" className="btn btn-primary" onClick={() => next(true)}>Got it</button>
              </>
            ) : mode === "listening" ? (
              <div className="demo-listening" role="status"><span className="demo-rec" aria-hidden="true" /> Listening… <span className="pt-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span></div>
            ) : mode === "typing" ? (
              <form onSubmit={submitTyped} className="demo-type">
                <label htmlFor="demo-answer" className="sr-only">Your answer</label>
                <input id="demo-answer" className="input" autoFocus placeholder="Type your answer" value={typed} onChange={(e) => setTyped(e.target.value)} />
                <button className="btn btn-primary" aria-label="Check answer" disabled={!typed.trim()}><Send size={14} aria-hidden="true" /></button>
              </form>
            ) : (
              <>
                <button type="button" className="btn btn-primary" onClick={speak}><Mic size={14} aria-hidden="true" /> Speak</button>
                <button type="button" className="btn" onClick={() => setMode("typing")}><Keyboard size={14} aria-hidden="true" /> Type</button>
                <button type="button" className="btn btn-ghost" onClick={() => setFlipped(true)}>Show answer</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
