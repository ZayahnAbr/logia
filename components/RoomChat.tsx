"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Send, ArrowDown, AtSign } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { useRoom } from "@/components/RoomProvider";

// Study-room chat: grouped messages, day dividers, @mentions with autocomplete (people in the
// room or who've posted), a jump-to-latest pill, and an auto-growing composer.
type Who = { id: string; name: string; color: string | null; icon: string | null };
const first = (n: string) => n.split(/\s+/)[0];
const dayLabel = (d: Date) => {
  const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
};
const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

export function RoomChat({ compact = false }: { compact?: boolean }) {
  const { me, messages, send, chatVisible, people } = useRoom();
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<Who[]>([]); // mentions inserted into the draft
  const [query, setQuery] = useState<{ text: string; start: number } | null>(null);
  const [hi, setHi] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const lastCount = useRef(messages.length);

  useEffect(() => { chatVisible(true); return () => chatVisible(false); }, [chatVisible]);

  // Everyone you can mention: people here now, plus anyone who has posted.
  const roster = useMemo(() => {
    const map = new Map<string, Who>();
    for (const p of people) map.set(p.id, { id: p.id, name: p.name, color: p.color, icon: p.icon });
    for (const m of messages) if (!map.has(m.user_id)) map.set(m.user_id, { id: m.user_id, name: m.author, color: m.author_color ?? null, icon: m.author_icon ?? null });
    if (me) map.delete(me.id);
    return [...map.values()];
  }, [people, messages, me]);
  const matches = query ? roster.filter((w) => w.name.toLowerCase().includes(query.text.toLowerCase())).slice(0, 6) : [];

  // Stick to the bottom unless the reader scrolled up; then count what they haven't seen.
  useEffect(() => {
    const el = listRef.current; if (!el) return;
    const added = messages.length - lastCount.current;
    lastCount.current = messages.length;
    const mine = messages[messages.length - 1]?.user_id === me?.id;
    if (atBottom || mine) el.scrollTop = el.scrollHeight;
    else if (added > 0) setUnseen((u) => u + added);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);
  const onScroll = () => {
    const el = listRef.current; if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAtBottom(bottom); if (bottom) setUnseen(0);
  };
  const toLatest = () => { const el = listRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); setUnseen(0); };

  const grow = () => { const el = boxRef.current; if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; } };
  const onChange = (v: string, caret: number) => {
    setDraft(v); grow();
    const m = /(^|\s)@([\p{L}\w-]{0,20})$/u.exec(v.slice(0, caret));
    setQuery(m ? { text: m[2], start: caret - m[2].length - 1 } : null);
    setHi(0);
    setPicked((p) => p.filter((w) => v.includes(`@${first(w.name)}`)));
  };
  const insertMention = (w: Who) => {
    if (!query) return;
    const before = draft.slice(0, query.start), after = draft.slice(query.start + 1 + query.text.length);
    const next = `${before}@${first(w.name)} ${after}`;
    setDraft(next); setQuery(null);
    setPicked((p) => (p.some((x) => x.id === w.id) ? p : [...p, w]));
    requestAnimationFrame(() => { const el = boxRef.current; if (el) { const pos = before.length + first(w.name).length + 2; el.focus(); el.setSelectionRange(pos, pos); grow(); } });
  };

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    const mentionIds = picked.filter((w) => body.includes(`@${first(w.name)}`)).map((w) => w.id);
    setDraft(""); setPicked([]); requestAnimationFrame(grow);
    if (!(await send(body, mentionIds))) setDraft(body);
  };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (query && matches.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => (h + 1) % matches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => (h - 1 + matches.length) % matches.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(matches[hi]); return; }
      if (e.key === "Escape") { setQuery(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  // Render @Name as a chip; highlight the one that's you.
  const renderBody = (text: string) => text.split(/(@[\p{L}\w-]+)/u).map((part, i) => {
    if (!part.startsWith("@")) return <Fragment key={i}>{part}</Fragment>;
    const isMe = me && part.slice(1).toLowerCase() === first(me.name).toLowerCase();
    return <span key={i} className={`chat-mention${isMe ? " me" : ""}`}>{part}</span>;
  });

  return (
    <div className="chat" style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1, position: "relative" }}>
      <div ref={listRef} className="chat-list" onScroll={onScroll} aria-live="polite" aria-label="Chat messages" style={compact ? { maxHeight: 300 } : undefined}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <AtSign size={18} aria-hidden="true" />
            <span>No messages yet. Say hi, or type <b>@</b> to poke someone.</span>
          </div>
        )}
        {messages.map((m, idx) => {
          const prev = messages[idx - 1];
          const d = new Date(m.created_at);
          const newDay = !prev || new Date(prev.created_at).toDateString() !== d.toDateString();
          const grouped = !newDay && prev?.user_id === m.user_id && d.getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
          const mine = m.user_id === me?.id;
          const mentionsMe = !!me && (m.mentions?.includes(me.id) || new RegExp(`@${first(me.name)}\\b`, "i").test(m.body));
          return (
            <Fragment key={m.id}>
              {newDay && <div className="chat-day"><span>{dayLabel(d)}</span></div>}
              <div className={`chat-row${mine ? " mine" : ""}${grouped ? " grouped" : ""}${mentionsMe && !mine ? " poked" : ""}`}>
                {!mine && <span className="chat-av">{!grouped && <Avatar name={m.author} color={m.author_color} icon={m.author_icon} size={30} />}</span>}
                <div className="chat-col">
                  {!grouped && <div className="chat-meta">{mine ? "You" : m.author} <time dateTime={m.created_at}>{time(d)}</time></div>}
                  <div className="chat-bubble" title={grouped ? time(d) : undefined}>{renderBody(m.body)}</div>
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>

      {unseen > 0 && !atBottom && (
        <button type="button" className="chat-latest" onClick={toLatest}><ArrowDown size={14} aria-hidden="true" /> {unseen} new message{unseen === 1 ? "" : "s"}</button>
      )}

      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="chat-compose">
        {query && matches.length > 0 && (
          <ul className="chat-suggest" role="listbox" aria-label="Mention someone">
            {matches.map((w, i) => (
              <li key={w.id} role="option" aria-selected={i === hi}>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); insertMention(w); }} className={i === hi ? "on" : ""}>
                  <Avatar name={w.name} color={w.color} icon={w.icon} size={24} /> {w.name}
                  {people.some((p) => p.id === w.id) && <span className="live-dot" aria-label="in the room" />}
                </button>
              </li>
            ))}
          </ul>
        )}
        <label htmlFor={compact ? "dock-msg" : "room-msg"} className="sr-only">Message the room. Type @ to mention someone.</label>
        <textarea ref={boxRef} id={compact ? "dock-msg" : "room-msg"} className="chat-input" rows={1} maxLength={1000}
          placeholder="Message the room, @ to poke someone" value={draft}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart)} onKeyDown={onKey}
          aria-autocomplete="list" aria-expanded={!!query && matches.length > 0} />
        <button className="btn btn-primary chat-send" aria-label="Send message" disabled={!draft.trim()}><Send size={15} aria-hidden="true" /></button>
      </form>
    </div>
  );
}
