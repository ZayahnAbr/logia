"use client";

import { useEffect, useState } from "react";
import "../../../../workspace-layout.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Play, RotateCcw, VolumeX, Timer, MessageSquare, Headphones, ChevronDown, ChevronUp, Mic, MicOff, Maximize2, Minimize2, Bell, BellOff } from "lucide-react";
import { useRoom, type Room, type Message } from "@/components/RoomProvider";
import { Avatar } from "@/components/Avatar";
import { RoomChat } from "@/components/RoomChat";
import { VoiceControls } from "@/components/VoiceControls";
import { ShareButton } from "@/components/ShareSheet";

export type { Message };
const firstName = (n: string) => n.split(/\s+/)[0];
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function RoomView({ room: initial, initialMessages }: { spaceId: string; room: Room; initialMessages: Message[] }) {
  const router = useRouter();
  const ctx = useRoom();
  const { me, people, remaining, setTimer, leave, unread } = ctx;
  const [chatOpen, setChatOpen] = useState(!initial.silent);
  const [chatBig, setChatBig] = useState(false);
  // Arriving from a poke notification opens (and enlarges) the chat.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("chat") === "1") { setChatOpen(true); setChatBig(true); }
  }, []);

  // Joining is idempotent; leaving the page keeps you in the room (the dock takes over).
  useEffect(() => { ctx.join(initial, initialMessages); }, [initial.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const room = ctx.room?.id === initial.id ? ctx.room : initial;
  const list = people.length ? people : me ? [{ id: me.id, name: me.name, color: me.color, icon: me.icon, voice: false, muted: false }] : [];
  const total = room.timer_minutes * 60;
  const running = !!room.timer_started_at && remaining > 0;
  const finished = !!room.timer_started_at && remaining === 0;
  const pct = total ? (remaining / total) * 100 : 0;

  const exit = async () => { await leave(); router.push(`/spaces/${room.space_id}/rooms`); };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-ghost" onClick={exit}><ArrowLeft size={14} aria-hidden="true" /> Leave room</button>
        <ShareButton label="Invite to room" className="btn btn-sm" note="Classmates need to be members of this space to join."
          data={{ title: `Join my study room: ${room.title}`, text: room.goal ? `Goal: ${room.goal}` : undefined, url: typeof window !== "undefined" ? window.location.href : undefined }} />
      </div>

      <section className="mesh-warm" style={{ borderRadius: 20, padding: "28px 28px 30px" }} aria-labelledby="room-title">
        <p className="eyebrow" style={{ color: "rgba(17,17,17,.78)", margin: 0 }}>Study room</p>
        <h1 id="room-title" style={{ fontSize: "clamp(1.5rem,3.4vw,2.2rem)", fontWeight: 700, margin: "6px 0 16px", lineHeight: 1.1 }}>{room.title}</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex" }}>
            {list.slice(0, 6).map((p, i) => (
              <span key={p.id} style={{ marginLeft: i ? -8 : 0, position: "relative" }}>
                <Avatar name={p.name} color={p.color} icon={p.icon} size={38} ring title={p.name} />
                {p.voice && <span className="room-voice-badge" aria-hidden="true">{p.muted ? <MicOff size={10} /> : <Mic size={10} />}</span>}
              </span>
            ))}
          </div>
          <div aria-live="polite">
            <div style={{ fontSize: 15, fontWeight: 650 }}><span className="live-dot" aria-hidden="true" /> {list.length} {list.length === 1 ? "person" : "people"} studying</div>
            <div style={{ fontSize: 13.5, color: "rgba(17,17,17,.78)" }}>{list.map((p) => (p.id === me?.id ? "You" : firstName(p.name))).join(" · ")}</div>
          </div>
        </div>
      </section>

      <div className="room-grid">
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <section className="card" style={{ padding: "18px 22px" }} aria-labelledby="goal-h">
            <h2 id="goal-h" className="eyebrow" style={{ margin: 0, color: "var(--accent-text)" }}>Session goal</h2>
            <p style={{ fontSize: 16, lineHeight: 1.55, margin: "6px 0 0", fontWeight: 500 }}>{room.goal || "No goal set. Agree on one in chat before you start."}</p>
          </section>

          <section className="card" style={{ padding: 22, display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }} aria-labelledby="timer-h">
            <div role="img" aria-label={`${fmt(remaining)} remaining`} style={{ width: 120, height: 120, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center", background: `conic-gradient(var(--accent) ${pct * 3.6}deg, var(--surface-2) 0deg)` }}>
              <div style={{ width: 100, height: 100, borderRadius: "50%", background: "var(--surface)", display: "grid", placeItems: "center", fontSize: 24, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(remaining)}</div>
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <h2 id="timer-h" style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Shared {room.timer_minutes}-minute timer</h2>
              <p style={{ fontSize: 13.5, color: "var(--muted)", margin: "4px 0 12px" }}>
                {finished ? "Session complete. Take a 10-minute break, then start another round."
                  : running ? "Everyone in the room sees the same countdown, even on other pages."
                  : "Start when everyone's ready. It starts for the whole room."}
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {!running && <button className="btn btn-primary" onClick={() => setTimer(true)}><Play size={14} aria-hidden="true" /> {finished ? "Start another round" : "Start timer"}</button>}
                {room.timer_started_at && <button className="btn btn-ghost" onClick={() => setTimer(false)}><RotateCcw size={14} aria-hidden="true" /> Reset</button>}
              </div>
            </div>
          </section>

          {room.voice_enabled !== false && (
            <section className="card" style={{ padding: "16px 22px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }} aria-labelledby="voice-h">
              <div style={{ flex: 1, minWidth: 180 }}>
                <h2 id="voice-h" style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Voice chat</h2>
                <p style={{ fontSize: 13, color: "var(--muted)", margin: "2px 0 0" }}>
                  {room.silent ? "This is a silent room, so use voice for quick questions and breaks." : "Talk it through. Your mic stays connected while you move between pages."}
                </p>
              </div>
              <VoiceControls />
            </section>
          )}

          <ul aria-label="Room format" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {room.silent && <li className="room-chip"><VolumeX size={13} aria-hidden="true" /> Silent co-study</li>}
            <li className="room-chip"><Timer size={13} aria-hidden="true" /> Shared {room.timer_minutes}-minute timer</li>
            {room.chat_enabled && <li className="room-chip"><MessageSquare size={13} aria-hidden="true" /> Chat available</li>}
            {room.voice_enabled !== false && <li className="room-chip"><Headphones size={13} aria-hidden="true" /> Voice available</li>}
          </ul>
        </div>

        {room.chat_enabled && (
          <section className={`card room-chat${chatBig && chatOpen ? " is-big" : ""}`} aria-labelledby="chat-h">
            <div className="room-chat-head">
              <button type="button" className="room-chat-toggle" aria-expanded={chatOpen} aria-controls="room-chat-body" onClick={() => setChatOpen((o) => !o)}>
                <span id="chat-h" style={{ fontWeight: 600, fontSize: 14 }}>Chat</span>
                {!chatOpen && unread > 0 && <span className="room-badge">{unread} new</span>}
                {room.silent && <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 400 }}>Keep it brief</span>}
                {chatOpen ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
              </button>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => ctx.setPokesMuted(!ctx.pokesMuted)} aria-pressed={ctx.pokesMuted}
                aria-label={ctx.pokesMuted ? "Unmute pokes" : "Mute pokes"} title={ctx.pokesMuted ? "Pokes are muted" : "Mute pokes (@mention notifications)"}>
                {ctx.pokesMuted ? <BellOff size={15} /> : <Bell size={15} />}
              </button>
              {chatOpen && (
                <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setChatBig((b) => !b)} aria-pressed={chatBig}
                  aria-label={chatBig ? "Shrink chat" : "Expand chat"} title={chatBig ? "Shrink chat" : "Expand chat"}>
                  {chatBig ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
              )}
            </div>
            {chatOpen && <div id="room-chat-body" style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}><RoomChat /></div>}
          </section>
        )}
      </div>

      <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
        You stay in the room while you study elsewhere, and a small room bar follows you. Go to{" "}
        <Link href={`/spaces/${room.space_id}/decks`} style={{ color: "var(--accent-text)", fontWeight: 600 }}>Flashcards</Link> ·{" "}
        <Link href={`/spaces/${room.space_id}/papers`} style={{ color: "var(--accent-text)", fontWeight: 600 }}>Past papers</Link>
      </p>
    </div>
  );
}
