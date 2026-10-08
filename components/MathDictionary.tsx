"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import katex from "katex";
import "katex/dist/katex.min.css";
import { Search, X, Plus, Copy, Check, Sigma } from "lucide-react";
import { MATH_TERMS, type MathTerm } from "@/lib/mathDictionary";

const Tex = ({ tex }: { tex: string }) => (
  <span className="mdict-tex" dangerouslySetInnerHTML={{ __html: katex.renderToString(tex, { throwOnError: false, displayMode: true }) }} />
);

// Slide-over maths reference. Inside a note, "Insert" drops the term and formula into the page.
export function MathDictionary({ onClose, onInsert }: { onClose: () => void; onInsert?: (t: MathTerm) => void }) {
  const [q, setQ] = useState("");
  const [topic, setTopic] = useState("All");
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const topics = useMemo(() => ["All", ...new Set(MATH_TERMS.map((t) => t.topic))], []);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return MATH_TERMS.filter((t) => (topic === "All" || t.topic === topic) &&
      (!s || [t.term, t.def, t.topic, ...(t.aka ?? [])].some((x) => x.toLowerCase().includes(s))));
  }, [q, topic]);

  const copy = async (t: MathTerm) => {
    try { await navigator.clipboard.writeText(`${t.term}: ${t.plain ?? t.def}`); setCopied(t.term); setTimeout(() => setCopied(null), 1500); } catch { /* */ }
  };

  const panel = (
    <div className="mdict-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="mdict" role="dialog" aria-modal="true" aria-labelledby="md-title">
        <header className="mdict-head">
          <span className="mdict-badge" aria-hidden="true"><Sigma size={16} /></span>
          <h2 id="md-title">Math dictionary</h2>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close math dictionary"><X size={16} /></button>
        </header>
        <div className="mdict-search">
          <Search size={15} aria-hidden="true" />
          <label htmlFor="md-q" className="sr-only">Search terms</label>
          <input id="md-q" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, e.g. chain rule, variance" />
        </div>
        <div className="mdict-topics" role="tablist" aria-label="Topics">
          {topics.map((t) => <button key={t} type="button" role="tab" aria-selected={topic === t} className={topic === t ? "on" : ""} onClick={() => setTopic(t)}>{t}</button>)}
        </div>
        <ul className="mdict-list">
          {list.length === 0 && <li className="mdict-empty">No terms match “{q}”.</li>}
          {list.map((t) => (
            <li key={t.term} className="mdict-item">
              <div className="mdict-item-head">
                <strong>{t.term}</strong>
                <span className="mdict-topic">{t.topic}</span>
              </div>
              <p>{t.def}</p>
              {t.tex && <Tex tex={t.tex} />}
              {t.example && <p className="mdict-ex"><b>Example:</b> {t.example}</p>}
              <div className="mdict-actions">
                {onInsert && <button type="button" className="btn btn-sm" onClick={() => onInsert(t)}><Plus size={13} aria-hidden="true" /> Insert into note</button>}
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => copy(t)}>{copied === t.term ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />} {copied === t.term ? "Copied" : "Copy"}</button>
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
  // Inside a full-screen note, render into that element so the panel stays visible.
  return typeof document === "undefined" ? null : createPortal(panel, (document.fullscreenElement as HTMLElement | null) ?? document.body);
}
