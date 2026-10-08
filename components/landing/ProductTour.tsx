"use client";

import { useEffect, useRef, useState } from "react";
import { Layers, FileCheck2, Users, Workflow, MessageSquare, Mic, Check, X as XIcon, Timer, Flame, BookOpen, LayoutDashboard } from "lucide-react";

// A faithful, miniature Logia window that switches between real screens.
// Auto-advances every 5s; pauses on hover/focus or after the visitor picks a tab.
const TABS = [
  { id: "cards", label: "Flashcards", icon: Layers, blurb: "Answer by voice, typing or handwriting. Logia checks what you remembered." },
  { id: "rooms", label: "Study rooms", icon: Users, blurb: "A shared goal, a shared timer, and chat or voice when you need it." },
  { id: "papers", label: "Past papers", icon: FileCheck2, blurb: "Upload a marked paper and see exactly where the marks went." },
  { id: "maps", label: "Mind maps", icon: Workflow, blurb: "Turn a chapter into a map you can edit, colour and rearrange." },
  { id: "ai", label: "Ask AI", icon: MessageSquare, blurb: "Ask about your notes and files. Every answer shows where it came from." },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function ProductTour() {
  const [tab, setTab] = useState<Tab>("cards");
  const [paused, setPaused] = useState(false);
  const [locked, setLocked] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (paused || locked || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setTimeout(() => {
      const i = TABS.findIndex((x) => x.id === tab);
      setTab(TABS[(i + 1) % TABS.length].id);
    }, 5000);
    return () => clearTimeout(t);
  }, [tab, paused, locked]);

  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div ref={rootRef} className="pt" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <div className="pt-head">
        <p className="eyebrow" style={{ color: "var(--accent-text)" }}>Inside Logia</p>
        <h2 className="l-h2">Everything for a module, <em className="serif">in one window</em></h2>
      </div>

      <div role="tablist" aria-label="Logia features" className="pt-tabs">
        {TABS.map(({ id, label, icon: I }) => (
          <button key={id} role="tab" id={`pt-tab-${id}`} aria-selected={tab === id} aria-controls="pt-panel"
            className={tab === id ? "on" : ""} onClick={() => { setTab(id); setLocked(true); }}>
            <I size={15} aria-hidden="true" /> {label}
            {tab === id && !paused && !locked && <span className="pt-progress" aria-hidden="true" />}
          </button>
        ))}
      </div>
      <p className="pt-blurb" aria-live="polite">{active.blurb}</p>

      <div className="pt-window" id="pt-panel" role="tabpanel" aria-labelledby={`pt-tab-${tab}`}>
        <div className="pt-chrome" aria-hidden="true"><i /><i /><i /><span>logia.app/spaces/psych-2</span></div>
        <div className="pt-app" aria-hidden="true">
          <aside className="pt-side">
            <span className="pt-logo">✳ logia</span>
            <span className="pt-nav"><LayoutDashboard size={12} /> Dashboard</span>
            <span className="pt-nav"><BookOpen size={12} /> Library</span>
            <span className="pt-group">Psych 2</span>
            {TABS.map(({ id, label, icon: I }) => <span key={id} className={`pt-nav${tab === id ? " on" : ""}`}><I size={12} /> {label}</span>)}
          </aside>
          <div className="pt-main" key={tab}>
            {tab === "cards" && <CardsScreen />}
            {tab === "papers" && <PapersScreen />}
            {tab === "rooms" && <RoomsScreen />}
            {tab === "maps" && <MapsScreen />}
            {tab === "ai" && <AiScreen />}
          </div>
        </div>
      </div>
    </div>
  );
}

const Head = ({ eyebrow, title }: { eyebrow: string; title: string }) => (
  <div className="pt-phead"><span>{eyebrow}</span><strong>{title}</strong></div>
);

function CardsScreen() {
  return (
    <>
      <Head eyebrow="Psych 2" title="Memory · 12 due" />
      <div className="pt-flash">
        <span className="pt-k">Question</span>
        <strong>Why do we remember the first and last items on a list best?</strong>
        <div className="pt-mic"><Mic size={13} /> “The first ones get rehearsed, the last ones are still fresh…” <span className="pt-wave"><i /><i /><i /><i /><i /></span></div>
      </div>
      <div className="pt-result">
        <div className="pt-score"><b>84%</b> strong recall</div>
        <span className="ok"><Check size={12} /> Primacy: early items get rehearsed</span>
        <span className="miss"><XIcon size={12} /> Missed: the name, recency effect</span>
      </div>
      <div className="pt-rate"><span>Again</span><span>Hard</span><span className="on">Good</span></div>
    </>
  );
}

function PapersScreen() {
  const qs = [["1.1", "Define working memory", true], ["1.2", "Baddeley’s model", true], ["2.1", "Serial position effect", false], ["2.2", "Chunking example", true], ["3.1", "Levels of processing", false]] as const;
  return (
    <>
      <Head eyebrow="Past papers" title="Paper 2 · June 2024" />
      <div className="pt-paper">
        <span className="pt-ring"><span>74%</span></span>
        <div><strong>17 of 23 marks</strong><span>Work on: Serial position, Levels of processing</span></div>
      </div>
      <ul className="pt-qs">
        {qs.map(([n, t, ok]) => <li key={n} className={ok ? "ok" : "miss"}><b>{n}</b> {t} {ok ? <Check size={12} /> : <XIcon size={12} />}</li>)}
      </ul>
      <div className="pt-cta"><Flame size={12} /> 2 topics added to your pain points</div>
    </>
  );
}

function RoomsScreen() {
  const ppl = [["#f2836b", "Z", "Zayahn"], ["#a9c6a2", "M", "Mia"], ["#9cc3e6", "L", "Lebo"], ["#c6b8ea", "A", "Amara"]];
  return (
    <>
      <div className="pt-roomhead">
        <span className="pt-k" style={{ color: "rgba(17,17,17,.7)" }}>Study room</span>
        <strong>Psych 2 revision</strong>
        <span className="pt-ppl">{ppl.map(([c, l], i) => <i key={l} style={{ background: c, marginLeft: i ? -6 : 0 }}>{l}</i>)} <em><span className="live-dot" /> 4 studying</em></span>
      </div>
      <div className="pt-roomgrid">
        <div className="pt-timer"><span className="pt-tring"><b>38:12</b></span><small><Timer size={11} /> Shared 50-minute timer</small></div>
        <div className="pt-chat">
          <span><i style={{ background: "#a9c6a2" }}>M</i> Anyone done Q3?</span>
          <span><i style={{ background: "#9cc3e6" }}>L</i> Yes, it’s chunking</span>
          <span className="me">Thanks, starting now</span>
        </div>
      </div>
      <div className="pt-goal"><span className="pt-k">Session goal</span> Revise Lecture 6 and complete the practice questions.</div>
    </>
  );
}

function MapsScreen() {
  const nodes = [
    { x: 50, y: 50, l: "Memory", root: true },
    { x: 18, y: 22, l: "Working memory", c: "#f6c1c7" }, { x: 82, y: 22, l: "Long-term", c: "#9cc3e6" },
    { x: 16, y: 80, l: "Encoding", c: "#a9c6a2" }, { x: 84, y: 80, l: "Retrieval", c: "#c6b8ea" },
  ];
  return (
    <>
      <Head eyebrow="Mind maps" title="Chapter 6 · Memory" />
      <div className="pt-map">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">{nodes.slice(1).map((n) => <path key={n.l} d={`M50 50 C ${(50 + n.x) / 2} 50, ${(50 + n.x) / 2} ${n.y}, ${n.x} ${n.y}`} stroke={n.c} strokeWidth="1.2" fill="none" vectorEffect="non-scaling-stroke" />)}</svg>
        {nodes.map((n, i) => <span key={n.l} className={n.root ? "root" : ""} style={{ left: `${n.x}%`, top: `${n.y}%`, background: n.root ? "#18181b" : n.c, ["--i" as string]: i }}>{n.l}</span>)}
      </div>
    </>
  );
}

function AiScreen() {
  return (
    <>
      <Head eyebrow="Ask AI" title="Grounded in your notes" />
      <div className="pt-ai">
        <span className="q">What’s the difference between the phonological loop and the visuospatial sketchpad?</span>
        <span className="a">The <b>phonological loop</b> holds sound and speech, like repeating a number to yourself. The <b>visuospatial sketchpad</b> holds images and layout, like picturing a route.
          <em><FileCheck2 size={11} /> From: Week 3 notes · Lecture 5 slides</em></span>
      </div>
      <div className="pt-input">Ask about Psych 2…</div>
    </>
  );
}
