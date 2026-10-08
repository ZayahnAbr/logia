"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { ArrowLeft, Bell, BellOff, Check, ChevronDown, ChevronUp, Coffee, Flag, MessageCircle, Music, MoreHorizontal, Pause, Play, Send, UserX, Volume2, VolumeX, X } from "lucide-react";
import type { ReactNode } from "react";
import type { Embed } from "@/lib/musicEmbed";
import { createClient } from "@/lib/supabase/client";
import { useRoom } from "@/components/RoomProvider";
import { Avatar } from "@/components/Avatar";
import { toast } from "@/components/Toaster";
import { CafeScene, type CafeSceneId } from "@/components/CafeScene";
import { BASE_VEIL, IMAGE_VEIL, colorVeil } from "@/lib/userCafes";
import { getPhase, formatClock, clockTime } from "@/lib/cafeClock";
import { startAmbient, chime, audioCtx } from "@/lib/cafeAudio";
import { cleanChatMessage, MAX_CHAT } from "@/lib/moderation";
import { postCafeMessage, postUserCafeMessage } from "@/app/discover-actions";
import { ReportDialog } from "../../ReportDialog";

export type PublicRoom = { id: string; slug: string; name: string; scene: CafeSceneId; focus_minutes: number; break_minutes: number; anchor: string };
export type CafeMessage = { id: string; user_id: string; author: string; author_color: string | null; author_icon: string | null; body: string; created_at: string };

// Everything the immersive room needs, so public rooms and user-hosted rooms share one experience.
export type CafeConfig = {
  kind: "public" | "user";
  id: string;
  name: string;
  focus_minutes: number;
  break_minutes: number;
  anchor: string;
  channel: string;                         // presence channel name
  loop: { preset: CafeSceneId; src?: string; image?: string; color?: string };
  ambient: CafeSceneId | null;             // synthesized ambience; null hides the control
  music?: { embed?: Embed | null; audioSrc?: string | null };
  backHref: string;
  extra?: ReactNode;                       // owner / report tools shown under the header
};
type Entry = { id: string; name: string; color: string | null; icon: string | null; goal: string; doneCycle: number | null };

const MUTE_KEY = "logia.cafe.muted";
const RING = 2 * Math.PI * 118;

export function CafeRoom({ room, initialMessages }: { room: PublicRoom; initialMessages: CafeMessage[] }) {
  const config: CafeConfig = {
    kind: "public", id: room.id, name: room.name, focus_minutes: room.focus_minutes, break_minutes: room.break_minutes, anchor: room.anchor,
    channel: `cafe:${room.slug}`, loop: { preset: room.scene }, ambient: room.scene, backHref: "/discover?tab=rooms",
  };
  return <CafeRoomView room={config} initialMessages={initialMessages} />;
}

export function CafeRoomView({ room, initialMessages }: { room: CafeConfig; initialMessages: CafeMessage[] }) {
  const supabase = useMemo(() => createClient(), []);
  const { me } = useRoom();

  // The clock starts after mount so server and client markup match.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ph = now === null ? null : getPhase(room, now);
  const phase = ph?.phase ?? "focus";
  const totalSec = (phase === "focus" ? room.focus_minutes : room.break_minutes) * 60;

  // ── Sound ──
  const [sound, setSound] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const [chimeOn, setChimeOn] = useState(true);
  const ambient = useRef<ReturnType<typeof startAmbient>>(null);
  const volRef = useRef(volume);
  volRef.current = volume;
  useEffect(() => {
    if (!sound || !room.ambient) return;
    ambient.current = startAmbient(room.ambient, volRef.current);
    return () => { ambient.current?.stop(); ambient.current = null; };
  }, [sound, room.ambient]);
  useEffect(() => { ambient.current?.setVolume(volume); }, [volume]);
  // Browsers only allow audio after a gesture, so prime the context on the first one.
  useEffect(() => {
    const prime = () => { audioCtx(); };
    window.addEventListener("pointerdown", prime, { once: true });
    window.addEventListener("keydown", prime, { once: true });
    return () => { window.removeEventListener("pointerdown", prime); window.removeEventListener("keydown", prime); };
  }, []);

  // Chime and announce when the phase flips.
  const prevPhase = useRef<string | null>(null);
  const [announce, setAnnounce] = useState("");
  useEffect(() => {
    if (!ph) return;
    if (prevPhase.current && prevPhase.current !== ph.phase) {
      if (chimeOn) chime(ph.phase === "break");
      setAnnounce(ph.phase === "break" ? "Break time. Chat is open." : "Focus time. Chat is resting.");
      // A completed focus phase could be logged here with logFocusSession, but that action needs a
      // spaceId (focus_analytics.space_id) and cafés belong to no space, so café time is not counted.
    }
    prevPhase.current = ph.phase;
  }, [ph, chimeOn]);

  // ── Presence + intentions ──
  const [people, setPeople] = useState<Entry[]>([]);
  const [goal, setGoal] = useState("");
  const [doneCycle, setDoneCycle] = useState<number | null>(null);
  const chan = useRef<RealtimeChannel | null>(null);
  const joined = useRef(false);
  const entry = useRef<Entry | null>(null);
  entry.current = me ? { id: me.id, name: me.name, color: me.color, icon: me.icon, goal, doneCycle } : null;

  useEffect(() => {
    if (!me?.id) return;
    const ch = supabase.channel(room.channel, { config: { presence: { key: me.id } } });
    ch.on("presence", { event: "sync" }, () => {
      const st = ch.presenceState() as Record<string, Entry[]>;
      setPeople(Object.values(st).map((arr) => arr[arr.length - 1]).filter(Boolean));
    }).subscribe((status) => {
      if (status === "SUBSCRIBED") { joined.current = true; if (entry.current) void ch.track(entry.current); }
    });
    chan.current = ch;
    return () => { joined.current = false; chan.current = null; supabase.removeChannel(ch); };
  }, [supabase, room.channel, me?.id]);

  useEffect(() => {
    if (joined.current && entry.current) void chan.current?.track(entry.current);
  }, [goal, doneCycle, me?.name, me?.color, me?.icon]);

  const isDone = ph !== null && doneCycle === ph.cycleIndex;

  // ── Chat ──
  const [messages, setMessages] = useState<CafeMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [muted, setMuted] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => { try { setMuted(JSON.parse(localStorage.getItem(MUTE_KEY) ?? "[]")); } catch { /* storage blocked */ } }, []);
  const mute = (id: string, name: string) => {
    const next = [...new Set([...muted, id])];
    setMuted(next);
    try { localStorage.setItem(MUTE_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
    setMenuFor(null);
    toast(`${name} is muted on this device.`);
  };

  const addMessage = useCallback((m: CafeMessage) => setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m].slice(-100))), []);
  useEffect(() => {
    const ch = supabase.channel(`cafe-chat:${room.kind}:${room.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cafe_messages", filter: `${room.kind === "user" ? "cafe_id" : "room_id"}=eq.${room.id}` }, (p) => addMessage(p.new as CafeMessage))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, room.kind, room.id, addMessage]);

  const visible = messages.filter((m) => !muted.includes(m.user_id));
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [visible.length, phase, chatOpen]);
  useEffect(() => {
    if (!chatOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setChatOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatOpen]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phase !== "break" || sending) return;
    const check = cleanChatMessage(draft);
    if (!check.ok) { toast(check.error, "error"); return; }
    setSending(true);
    const res = room.kind === "user" ? await postUserCafeMessage(room.id, draft) : await postCafeMessage(room.id, draft);
    setSending(false);
    if ("error" in res) { toast(res.error, "error"); return; }
    setDraft("");
    if (me) addMessage({ id: res.id, user_id: me.id, author: me.name, author_color: me.color, author_icon: me.icon, body: res.body, created_at: new Date().toISOString() });
  };

  const others = people.filter((p) => p.id !== me?.id);
  const breakGoals = others.filter((p) => p.goal && !muted.includes(p.id));
  const shown = people.slice(0, 14);
  const nextAt = ph ? clockTime(ph.endsAtMs) : "";
  const timeText = ph ? formatClock(ph.remainingSec) : "--:--";
  const count = people.length;

  return (
    <div className={`cafe-room${room.extra ? " has-extra" : ""}`} data-phase={phase}>
      <CafeScene scene={room.loop.preset} src={room.loop.src} image={room.loop.image} color={room.loop.color} />
      <div className="cafe-veil" aria-hidden="true"
        style={room.loop.color ? { background: `rgba(0,0,0,${colorVeil(room.loop.color)})` } : room.loop.image ? { background: `rgba(0,0,0,${IMAGE_VEIL})` } : { background: `rgba(0,0,0,${BASE_VEIL})` }} />

      <header className="cafe-top">
        <Link href={room.backHref} className="cafe-btn"><ArrowLeft size={16} aria-hidden="true" /> Leave</Link>
        <h1 className="cafe-title">{room.name}</h1>
        <div className="cafe-tools">
          {room.ambient && (
            <button type="button" className="cafe-btn cafe-icon" aria-pressed={sound} onClick={() => setSound((s) => !s)} aria-label={sound ? "Turn ambient sound off" : "Turn ambient sound on"}>
              {sound ? <Volume2 size={16} aria-hidden="true" /> : <VolumeX size={16} aria-hidden="true" />}
            </button>
          )}
          {sound && room.ambient && (
            <label className="cafe-vol">
              <span className="sr-only">Ambient volume</span>
              <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
            </label>
          )}
          <button type="button" className="cafe-btn cafe-icon" aria-pressed={chimeOn} onClick={() => setChimeOn((c) => !c)} aria-label={chimeOn ? "Mute the phase chime" : "Unmute the phase chime"}>
            {chimeOn ? <Bell size={16} aria-hidden="true" /> : <BellOff size={16} aria-hidden="true" />}
          </button>
          <button type="button" className="cafe-btn cafe-icon cafe-chat-toggle" onClick={() => setChatOpen(true)} aria-label="Open chat" aria-expanded={chatOpen}>
            <MessageCircle size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      {room.extra && <div className="cafe-extra">{room.extra}</div>}
      {room.music && (room.music.embed || room.music.audioSrc) && <CafeMusic music={room.music} />}

      <main id="main" className="cafe-main">
        <div className="cafe-timer">
          <svg viewBox="0 0 260 260" className="cafe-ring" aria-hidden="true">
            <circle cx="130" cy="130" r="118" className="track" />
            <circle cx="130" cy="130" r="118" className="bar" strokeDasharray={RING} strokeDashoffset={ph ? RING * (1 - ph.remainingSec / totalSec) : RING} transform="rotate(-90 130 130)" />
          </svg>
          <div className="cafe-timer-in">
            <div className="cafe-phase">{phase === "focus" ? "Focus" : "Break"}</div>
            <div className="cafe-time" role="timer" aria-label={ph ? `${formatClock(ph.remainingSec)} left in ${phase}` : "Loading timer"}>{timeText}</div>
            <div className="cafe-next">{ph ? (phase === "focus" ? `Next: ${room.break_minutes} min break at ${nextAt}` : `Next: ${room.focus_minutes} min focus at ${nextAt}`) : " "}</div>
          </div>
        </div>
        <p className="sr-only" role="status">{announce}</p>

        <div className="cafe-people">
          <div className="cafe-count"><span className="live-dot" aria-hidden="true" /> {count === 1 ? "1 person studying" : `${count} people studying`}</div>
          {shown.length > 0 && (
            <div className="cafe-dots" aria-hidden="true">
              {shown.map((p) => <Avatar key={p.id} name={p.name} color={p.color} icon={p.icon} size={26} title={p.name} />)}
              {count > shown.length && <span className="cafe-more">+{count - shown.length}</span>}
            </div>
          )}
        </div>

        <form className="cafe-goal" onSubmit={(e) => { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur(); }}>
          <label htmlFor="cafe-goal" className="cafe-goal-label">What are you working on?</label>
          <div className="cafe-goal-row">
            <input id="cafe-goal" className="cafe-input" value={goal} maxLength={80} placeholder="One line, shown to others in the room" onChange={(e) => setGoal(e.target.value)} />
            {phase === "break" && goal.trim() && (
              <button type="button" className="cafe-btn" aria-pressed={isDone} onClick={() => ph && setDoneCycle(isDone ? null : ph.cycleIndex)}>
                <Check size={16} aria-hidden="true" /> {isDone ? "Done" : "Mark done"}
              </button>
            )}
          </div>
        </form>

        {phase === "break" && breakGoals.length > 0 && (
          <section className="cafe-goals" aria-label="What others are working on">
            <h2>What others are working on</h2>
            <ul>
              {breakGoals.slice(0, 6).map((p) => (
                <li key={p.id}><Avatar name={p.name} color={p.color} icon={p.icon} size={20} /> <span className="truncate"><b>{p.name}</b> {p.goal}</span>{p.doneCycle === ph?.cycleIndex && <span className="cafe-done"><Check size={12} aria-hidden="true" /> done</span>}</li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <aside className={`cafe-chat${chatOpen ? " open" : ""}`} aria-label="Room chat">
        <div className="cafe-chat-head">
          <h2>Chat</h2>
          <button type="button" className="cafe-btn cafe-icon cafe-chat-close" onClick={() => setChatOpen(false)} aria-label="Close chat"><X size={16} aria-hidden="true" /></button>
        </div>

        {phase === "focus" ? (
          <div className="cafe-rest">
            <Coffee size={28} aria-hidden="true" />
            <p>Chat is resting until the break{ph ? ` at ${nextAt}` : ""}.</p>
            <span>Stay with it. You can say hello in a few minutes.</span>
          </div>
        ) : (
          <div className="cafe-log" ref={logRef} role="log" aria-label="Messages">
            {visible.length === 0 && <p className="cafe-empty">Quiet so far. Say hello.</p>}
            {visible.map((m) => (
              <div key={m.id} className="cafe-msg">
                <Avatar name={m.author} color={m.author_color} icon={m.author_icon} size={24} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="cafe-msg-by">{m.author}{m.user_id === me?.id ? " (you)" : ""}</div>
                  <div className="cafe-msg-body">{m.body}</div>
                  {menuFor === m.id && (
                    <div className="cafe-menu">
                      <button type="button" onClick={() => { setReporting(m.id); setMenuFor(null); }}><Flag size={13} aria-hidden="true" /> Report</button>
                      <button type="button" onClick={() => mute(m.user_id, m.author)}><UserX size={13} aria-hidden="true" /> Mute this person</button>
                    </div>
                  )}
                </div>
                {m.user_id !== me?.id && (
                  <button type="button" className="cafe-more-btn" aria-label={`Options for ${m.author}'s message`} aria-expanded={menuFor === m.id} onClick={() => setMenuFor(menuFor === m.id ? null : m.id)}>
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <form className="cafe-compose" onSubmit={send}>
          <label htmlFor="cafe-msg" className="sr-only">Message</label>
          <input id="cafe-msg" className="cafe-input" value={draft} maxLength={MAX_CHAT} disabled={phase !== "break"} autoComplete="off"
            placeholder={phase === "break" ? "Say something kind" : "Chat opens on the break"} onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" className="cafe-btn cafe-icon" disabled={phase !== "break" || sending || !draft.trim()} aria-label="Send message"><Send size={16} aria-hidden="true" /></button>
        </form>
      </aside>

      {reporting && <ReportDialog kind="cafe_message" targetId={reporting} onClose={() => setReporting(null)} />}
    </div>
  );
}

// Host-chosen music. Uploaded tracks wait for a tap (never autoplay with sound); links show the official embed on request.
function CafeMusic({ music }: { music: NonNullable<CafeConfig["music"]> }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [vol, setVol] = useState(0.6);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (audio.current) audio.current.volume = vol; }, [vol]);

  const toggle = () => {
    const a = audio.current; if (!a) return;
    if (a.paused) a.play().then(() => setPlaying(true)).catch(() => toast("Couldn't play the track. Try again.", "error"));
    else { a.pause(); setPlaying(false); }
  };

  if (music.audioSrc) {
    return (
      <div className="cafe-music" role="group" aria-label="Room music">
        <audio ref={audio} src={music.audioSrc} loop preload="none" onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} />
        <button type="button" className="cafe-btn cafe-icon" onClick={toggle} aria-pressed={playing} aria-label={playing ? "Pause the room music" : "Play the room music"}>
          {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
        </button>
        <span className="cafe-music-label"><Music size={14} aria-hidden="true" /> Room music</span>
        <label className="cafe-vol">
          <span className="sr-only">Music volume</span>
          <input type="range" min={0} max={1} step={0.05} value={vol} onChange={(e) => setVol(Number(e.target.value))} />
        </label>
      </div>
    );
  }
  const embed = music.embed!;
  return (
    <div className="cafe-music cafe-music-embed">
      <button type="button" className="cafe-btn" aria-expanded={open} aria-controls="cafe-embed" onClick={() => setOpen((o) => !o)}>
        <Music size={16} aria-hidden="true" /> {embed.label} music {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />}
      </button>
      {open && (
        <div id="cafe-embed" className="cafe-embed">
          <iframe title={`${embed.label} player`} src={embed.src} height={Math.min(embed.height, 352)} loading="lazy"
            allow="autoplay; encrypted-media; clipboard-write; fullscreen" referrerPolicy="strict-origin-when-cross-origin" />
        </div>
      )}
    </div>
  );
}
