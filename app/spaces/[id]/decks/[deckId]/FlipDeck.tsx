"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, RotateCcw, Check, Repeat, ChevronsUp } from "lucide-react";
import { rateCard } from "@/app/actions";
import type { Card, Rating } from "@/lib/types";

// Full-screen flip-card practice. Tap/Space flips; swipe or arrow keys rate:
// right = Got it, left = Again, up = Hard. Ratings feed the same FSRS schedule as Study.
const THRESHOLD = 110;

export function FlipDeck({ spaceId, deckId, cards, onClose }: { spaceId: string; deckId: string; cards: Card[]; onClose: () => void }) {
  const [queue] = useState(cards);
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const [leaving, setLeaving] = useState<Rating | null>(null);
  const [tally, setTally] = useState({ got: 0, fuzzy: 0, missed: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const card = queue[i];
  const done = i >= queue.length;

  useEffect(() => {
    rootRef.current?.requestFullscreen?.().catch(() => { /* overlay already covers the window */ });
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  }, []);
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement && rootRef.current) { /* user pressed Esc in fullscreen: keep overlay */ } };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const rate = useCallback((r: Rating) => {
    if (!card || leaving) return;
    if (!flipped && r !== "missed") { setFlipped(true); return; } // see the answer before claiming you knew it
    setLeaving(r);
    rateCard(spaceId, deckId, card.id, r).catch(() => {});
    setTally((t) => ({ ...t, [r]: t[r] + 1 }));
    window.setTimeout(() => { setLeaving(null); setDrag({ x: 0, y: 0, active: false }); setFlipped(false); setI((n) => n + 1); }, 260);
  }, [card, deckId, flipped, leaving, spaceId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (done) return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); setFlipped((f) => !f); }
      if (e.key === "ArrowRight") rate("got");
      if (e.key === "ArrowLeft") rate("missed");
      if (e.key === "ArrowUp") { e.preventDefault(); rate("fuzzy"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done, onClose, rate]);

  const down = (e: React.PointerEvent) => { start.current = { x: e.clientX, y: e.clientY, moved: false }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const move = (e: React.PointerEvent) => {
    if (!start.current) return;
    const x = e.clientX - start.current.x, y = e.clientY - start.current.y;
    if (Math.abs(x) + Math.abs(y) > 6) start.current.moved = true;
    setDrag({ x, y, active: true });
  };
  const up = () => {
    const s = start.current; start.current = null;
    if (!s) return;
    if (!s.moved) { setDrag({ x: 0, y: 0, active: false }); setFlipped((f) => !f); return; }
    if (drag.x > THRESHOLD) rate("got");
    else if (drag.x < -THRESHOLD) rate("missed");
    else if (drag.y < -THRESHOLD) rate("fuzzy");
    else setDrag({ x: 0, y: 0, active: false });
  };

  const fly = leaving === "got" ? { x: 900, y: drag.y } : leaving === "missed" ? { x: -900, y: drag.y } : leaving === "fuzzy" ? { x: drag.x, y: -900 } : drag;
  const intent = drag.x > 40 ? "got" : drag.x < -40 ? "missed" : drag.y < -40 ? "fuzzy" : null;
  const strength = Math.min(1, Math.max(Math.abs(drag.x), -drag.y) / THRESHOLD);

  const view = (
    <div ref={rootRef} className="fd" role="dialog" aria-modal="true" aria-label="Flashcard practice">
      <div className="fd-top">
        <div className="fd-progress" aria-hidden="true"><span style={{ width: `${(Math.min(i, queue.length) / queue.length) * 100}%` }} /></div>
        <span className="fd-count" aria-live="polite">{done ? "Done" : `${i + 1} / ${queue.length}`}</span>
        <button type="button" className="fd-close" onClick={onClose} aria-label="Exit practice"><X size={18} /></button>
      </div>

      {done ? (
        <div className="fd-done">
          <strong>Deck complete</strong>
          <div className="fd-tally">
            <span className="got"><b>{tally.got}</b> Got it</span>
            <span className="fuzzy"><b>{tally.fuzzy}</b> Hard</span>
            <span className="missed"><b>{tally.missed}</b> Again</span>
          </div>
          <p>Cards you marked Again come back first next time.</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-lg l-btn-soft" onClick={() => { setI(0); setTally({ got: 0, fuzzy: 0, missed: 0 }); }}><RotateCcw size={15} aria-hidden="true" /> Go again</button>
            <button type="button" className="btn btn-lg btn-primary" onClick={onClose}>Finish</button>
          </div>
        </div>
      ) : (
        <div className="fd-stage">
          {queue[i + 1] && <div className="fd-next" aria-hidden="true" />}
          <div className={`fd-card${flipped ? " is-flipped" : ""}${drag.active || leaving ? "" : " settle"}`}
            style={{ transform: `translate3d(${fly.x}px, ${fly.y}px, 0) rotate(${fly.x / 18}deg)`, opacity: leaving ? 0 : 1 }}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
            role="button" tabIndex={0} aria-label={flipped ? `Answer: ${card.answer || card.hint}` : `Question: ${card.question}. Press space to flip`}>
            <div className="fd-inner">
              <div className="fd-face fd-front">
                <span className="fd-tag">{card.concept || "Question"}</span>
                <p className="fd-q">{card.question}</p>
                <span className="fd-hint">Tap to flip</span>
              </div>
              <div className="fd-face fd-back">
                <span className="fd-tag">Answer</span>
                <p className="fd-a">{card.answer || card.hint || "No answer saved yet. Check your recall in Study to generate one."}</p>
                <span className="fd-hint">Swipe right if you knew it, left to see it again</span>
              </div>
            </div>
            {intent && <span className={`fd-stamp ${intent}`} style={{ opacity: strength }}>{intent === "got" ? "Got it" : intent === "missed" ? "Again" : "Hard"}</span>}
          </div>
        </div>
      )}

      {!done && (
        <div className="fd-actions">
          <button type="button" className="fd-btn missed" onClick={() => rate("missed")}><Repeat size={18} aria-hidden="true" /> Again <kbd>←</kbd></button>
          <button type="button" className="fd-btn fuzzy" onClick={() => rate("fuzzy")}><ChevronsUp size={18} aria-hidden="true" /> Hard <kbd>↑</kbd></button>
          <button type="button" className="fd-btn got" onClick={() => rate("got")}><Check size={18} aria-hidden="true" /> Got it <kbd>→</kbd></button>
        </div>
      )}
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(view, document.body);
}
