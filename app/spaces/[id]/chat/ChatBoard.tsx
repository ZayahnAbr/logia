"use client";

import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Send, Loader2, BookOpen, FileText, Mic, ShieldCheck, RefreshCw, Copy, Check, Sparkles, Globe, Search, Trash2 } from "lucide-react";
import { ThinkingSteps } from "@/components/ThinkingSteps";
import { chatWithSpace, reindexSpace, getAskSuggestions, type AskSource } from "@/app/actions";
import { loadChat, appendChat, clearChat } from "@/app/chat-history-actions";

type Message = { role: "user" | "assistant"; content: string; sources?: AskSource[]; grounded?: boolean; noMatch?: boolean; question?: string };

const SOURCE_ICON: Record<string, React.ReactNode> = { note: <FileText size={12} />, lecture: <Mic size={12} />, file: <BookOpen size={12} /> };
const hrefFor = (spaceId: string, s: AskSource) => s.type === "note" ? `/spaces/${spaceId}/notes?note=${s.id}` : s.type === "lecture" ? `/spaces/${spaceId}/lectures` : `/spaces/${spaceId}/files`;

// Small, safe markdown: paragraphs, **bold**, "- " bullets, "1. " steps, and [n] citation chips.
function Rich({ text, onCite }: { text: string; onCite: (n: number) => void }) {
  const inline = (line: string, k: string) => line.split(/(\*\*[^*]+\*\*|\[\d+\])/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={`${k}-${i}`}>{part.slice(2, -2)}</strong>;
    const c = /^\[(\d+)\]$/.exec(part);
    if (c) return <button key={`${k}-${i}`} type="button" className="ai-cite" onClick={() => onCite(Number(c[1]))} aria-label={`Source ${c[1]}`}>{c[1]}</button>;
    return <Fragment key={`${k}-${i}`}>{part}</Fragment>;
  });
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = (k: number) => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(<Tag key={`l${k}`}>{list.items.map((it, i) => <li key={i}>{inline(it, `li${k}-${i}`)}</li>)}</Tag>);
    list = null;
  };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    const b = /^[-*•]\s+(.*)/.exec(line), o = /^\d+[.)]\s+(.*)/.exec(line);
    if (b || o) {
      const ordered = !!o;
      if (!list || list.ordered !== ordered) { flush(i); list = { ordered, items: [] }; }
      list.items.push((b ?? o)![1]);
      return;
    }
    flush(i);
    if (!line) return;
    const h = /^#{1,4}\s+(.*)/.exec(line);
    blocks.push(h ? <p key={i} className="ai-h">{inline(h[1], `h${i}`)}</p> : <p key={i}>{inline(line, `p${i}`)}</p>);
  });
  flush(lines.length);
  return <div className="ai-rich">{blocks}</div>;
}

export function ChatBoard({ spaceId, indexedCount }: { spaceId: string; indexedCount: number }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, start] = useTransition();
  const [reindexing, startReindex] = useTransition();
  const [count, setCount] = useState(indexedCount);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [copied, setCopied] = useState<number | null>(null);
  const [focusSrc, setFocusSrc] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  const [canSave, setCanSave] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [announce, setAnnounce] = useState("");

  useEffect(() => { getAskSuggestions(spaceId).then(setSuggestions).catch(() => {}); }, [spaceId]);
  useEffect(() => {
    let live = true;
    loadChat(spaceId, "space").then((r) => {
      if (!live) return;
      setCanSave(r.available);
      if (r.messages.length > 0) setMessages((prev) => [...r.messages, ...prev]);
    }).catch(() => {}).finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [spaceId]);
  const doClear = async () => {
    setClearing(true);
    const r = await clearChat(spaceId, "space").catch(() => ({ ok: false }));
    setClearing(false); setConfirmClear(false);
    if (r.ok) { setMessages([]); setAnnounce("Chat cleared."); } else setAnnounce("Couldn't clear the chat. Try again.");
  };
  useEffect(() => { const el = threadRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); }, [messages, pending]);

  const ask = (q: string, mode: "grounded" | "general" = "grounded") => {
    if (!q.trim() || pending) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    if (mode === "grounded") setMessages((prev) => [...prev, { role: "user", content: q }]);
    start(async () => {
      const res = await chatWithSpace(spaceId, q, history, mode);
      if ("error" in res) { setMessages((prev) => [...prev, { role: "assistant", content: res.error, grounded: true }]); return; }
      setMessages((prev) => [...prev, { role: "assistant", content: res.answer, sources: res.sources, grounded: res.grounded, noMatch: res.noMatch, question: q }]);
      appendChat(spaceId, "space", null, mode === "grounded" ? q : "", { content: res.answer, sources: res.sources, grounded: res.grounded })
        .then((r) => { if (r.ok) setCanSave(true); }).catch(() => {});
    });
  };
  const send = () => { const q = input.trim(); if (!q) return; setInput(""); if (boxRef.current) boxRef.current.style.height = "auto"; ask(q); };

  const rebuild = () => startReindex(async () => { const res = await reindexSpace(spaceId); if ("count" in res) setCount(res.count ?? 0); });
  const copy = async (i: number, text: string) => { try { await navigator.clipboard.writeText(text.replace(/\[\d+\]/g, "")); setCopied(i); setTimeout(() => setCopied(null), 1500); } catch { /* */ } };
  const cite = (msgIdx: number, n: number) => { const id = `src-${msgIdx}-${n}`; setFocusSrc(id); document.getElementById(id)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); };

  return (
    <div className="ai-page ln-chat ln-h">
      <aside className="ln-chat-rail" aria-label="Index and suggestions">
        <div className="ai-status">
          <ShieldCheck size={14} aria-hidden="true" />
          <span>{count > 0 ? `Searching ${count} passages from your notes, lectures and files. Notes update automatically as you edit.` : "Nothing to search yet. Add notes, files or lectures to this space."}</span>
          <button className="btn btn-ghost btn-sm" onClick={rebuild} disabled={reindexing} title="Re-read everything in this space">
            {reindexing ? <Loader2 size={13} className="spin" aria-hidden="true" /> : <RefreshCw size={13} aria-hidden="true" />} Refresh index
          </button>
        </div>
        <p className="sr-only" role="status" aria-live="polite">{announce}</p>
        {canSave && messages.length > 0 && (
          <div className="ai-clear" role="group" aria-label="Chat history">
            {confirmClear ? (
              <>
                <span id="ai-clear-q">Clear this chat?</span>
                <button type="button" className="btn btn-sm ai-clear-yes" onClick={doClear} disabled={clearing} aria-describedby="ai-clear-q">{clearing ? "Clearing…" : "Clear"}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(false)} disabled={clearing} autoFocus>Keep</button>
              </>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(true)} disabled={pending}><Trash2 size={13} aria-hidden="true" /> Clear chat</button>
            )}
          </div>
        )}
        {suggestions.length > 0 && (
          <div className="ln-chat-sug">
            <h2>Try asking</h2>
            {suggestions.map((s) => <button key={s} type="button" onClick={() => ask(s)} disabled={pending}><Search size={13} aria-hidden="true" style={{ marginTop: 3, flexShrink: 0 }} /> {s}</button>)}
          </div>
        )}
      </aside>

      <div ref={threadRef} className="ai-thread" aria-live="polite">
        {messages.length === 0 && loaded && (
          <div className="ai-empty">
            <span className="ai-empty-ico" aria-hidden="true"><Sparkles size={22} /></span>
            <h2>Ask about anything in this space</h2>
            <p>Answers come from your notes, lectures and files, with the source of every claim.</p>
            {suggestions.length > 0 && (
              <div className="ai-suggest">
                {suggestions.map((s) => <button key={s} type="button" onClick={() => ask(s)}><Search size={13} aria-hidden="true" /> {s}</button>)}
              </div>
            )}
          </div>
        )}

        {messages.map((m, i) => m.role === "user" ? (
          <div key={i} className="ai-q">{m.content}</div>
        ) : (
          <div key={i} className="ai-a">
            {m.grounded === false && <span className="ai-general"><Globe size={12} aria-hidden="true" /> {m.noMatch ? "Nothing in your notes matched this, so this answer is from general knowledge, not from your materials" : "General knowledge, not from your notes"}</span>}
            <Rich text={m.content} onCite={(n) => cite(i, n)} />
            {m.sources && m.sources.length > 0 && (
              <ol className="ai-sources" aria-label="Sources">
                {m.sources.map((s) => (
                  <li key={s.n} id={`src-${i}-${s.n}`} className={focusSrc === `src-${i}-${s.n}` ? "on" : ""}>
                    <Link href={hrefFor(spaceId, s)}>
                      <span className="ai-src-n">{s.n}</span>
                      <span style={{ minWidth: 0 }}>
                        <span className="ai-src-t">{SOURCE_ICON[s.type] ?? <FileText size={12} />} {s.title}</span>
                        <span className="ai-src-s">{s.snippet}…</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
            <div className="ai-a-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(i, m.content)}>{copied === i ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />} {copied === i ? "Copied" : "Copy"}</button>
            </div>
          </div>
        ))}
        {pending && <ThinkingSteps steps={["Searching your notes and files", "Reading the parts that match", "Writing your answer", "Checking it against your notes", "Nearly there"]} />}
      </div>

      <form className="ai-compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label htmlFor="ai-q" className="sr-only">Ask a question about this space</label>
        <textarea ref={boxRef} id="ai-q" className="chat-input" rows={1} value={input} maxLength={1200}
          placeholder="Ask about your notes, e.g. explain the Krebs cycle simply"
          onChange={(e) => { setInput(e.target.value); const el = e.target; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="btn btn-primary chat-send" aria-label="Ask" disabled={pending || !input.trim()}><Send size={15} aria-hidden="true" /></button>
      </form>
    </div>
  );
}
