"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { X, Send, Loader2, ShieldCheck, FileText, Mic, BookOpen, Trash2 } from "lucide-react";
import { chatWithSpace } from "@/app/actions";
import { loadChat, appendChat, clearChat } from "@/app/chat-history-actions";

type Message = { role: "user" | "assistant"; content: string; sources?: { type: string; title: string }[] };

const ICON: Record<string, React.ReactNode> = {
  note:    <FileText size={11} />,
  lecture: <Mic size={11} />,
  file:    <BookOpen size={11} />,
  article: <BookOpen size={11} />,
};

export function NoteChat({
  spaceId,
  noteId,
  noteTitle,
  noteBody,
  onClose,
}: {
  spaceId: string;
  noteId: string;
  noteTitle: string;
  noteBody: string;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, start] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [canSave, setCanSave] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [announce, setAnnounce] = useState("");

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => {
    let live = true;
    loadChat(spaceId, "note", noteId).then((r) => {
      if (!live) return;
      setCanSave(r.available);
      if (r.messages.length > 0) setMessages((prev) => [...r.messages.map((m): Message => ({ role: m.role, content: m.content, sources: m.sources })), ...prev]);
    }).catch(() => {}).finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [spaceId, noteId]);
  const doClear = async () => {
    setClearing(true);
    const r = await clearChat(spaceId, "note", noteId).catch(() => ({ ok: false }));
    setClearing(false); setConfirmClear(false);
    if (r.ok) { setMessages([]); setAnnounce("Chat cleared."); } else setAnnounce("Couldn't clear the chat. Try again.");
  };

  const send = () => {
    const q = input.trim();
    if (!q || pending) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    start(async () => {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const contextualQ = noteTitle ? `(I'm currently reading a note titled "${noteTitle}") ${q}` : q;
      const res = await chatWithSpace(spaceId, contextualQ, history);
      if ("error" in res) setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${res.error}` }]);
      else {
        const content = (res.noMatch ? "Nothing in your notes matched this, so this answer is from general knowledge, not from your materials.\n\n" : "") + res.answer.replace(/\*\*/g, "");
        setMessages((prev) => [...prev, { role: "assistant", content, sources: res.sources }]);
        appendChat(spaceId, "note", noteId, q, { content, sources: res.sources, grounded: res.grounded })
          .then((r) => { if (r.ok) setCanSave(true); }).catch(() => {});
      }
    });
  };

  return (
    <div style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: "min(420px, 92vw)",
      background: "var(--surface)", borderLeft: "1px solid var(--border)",
      boxShadow: "-12px 0 40px rgba(0,0,0,.12)", zIndex: 90,
      display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px", borderBottom: "1px solid var(--border-soft)" }}>
        <ShieldCheck size={14} style={{ color: "var(--emerald)" }} />
        <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1 }}>Ask your space</span>
        {canSave && messages.length > 0 && !confirmClear && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(true)} disabled={pending}><Trash2 size={13} aria-hidden="true" /> Clear chat</button>
        )}
        <button aria-label="Close chat" className="btn btn-ghost" style={{ width: 30, height: 30, padding: 0 }} onClick={onClose}><X size={15} /></button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      {confirmClear && (
        <div className="ai-clear ai-clear-bar" role="group" aria-label="Chat history">
          <span id="note-clear-q">Clear this chat?</span>
          <button type="button" className="btn btn-sm ai-clear-yes" onClick={doClear} disabled={clearing} aria-describedby="note-clear-q">{clearing ? "Clearing…" : "Clear"}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(false)} disabled={clearing} autoFocus>Keep</button>
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.length === 0 && loaded && (
          <div style={{ textAlign: "center", padding: "30px 12px", color: "var(--faint)", fontSize: 13 }}>
            Ask about this space's notes, lectures and files.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "90%", padding: "10px 13px",
              borderRadius: m.role === "user" ? "14px 14px 3px 14px" : "3px 14px 14px 14px",
              background: m.role === "user" ? "var(--accent)" : "var(--surface-2)",
              color: m.role === "user" ? "#fff" : "var(--text)",
              fontSize: 13, lineHeight: 1.55,
            }}>
              {m.content}
            </div>
            {m.sources && m.sources.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5, maxWidth: "90%" }}>
                {[...new Map(m.sources.map((s) => [s.title, s])).values()].map((s, j) => (
                  <span key={j} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, fontWeight: 500, padding: "2px 7px", borderRadius: 999, background: "var(--accent-soft)", color: "var(--accent-text)" }}>
                    {ICON[s.type] ?? <FileText size={11} />} {s.title}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {pending && (
          <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--muted)", fontSize: 12.5 }}>
            <Loader2 size={13} className="spin" /> Searching…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: 14, borderTop: "1px solid var(--border-soft)", display: "flex", gap: 8 }}>
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask a question…"
          style={{ flex: 1, height: 40 }}
        />
        <button aria-label="Send message" className="btn btn-primary" onClick={send} disabled={pending || !input.trim()} style={{ width: 40, height: 40, padding: 0 }}>
          {pending ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
        </button>
      </div>
    </div>
  );
}
