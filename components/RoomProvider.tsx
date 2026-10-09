"use client";

import { hasBlockedWord, safeRemoteText } from "@/lib/moderation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sendRoomMessage, setRoomTimer, endRoom } from "@/app/room-actions";
import { toast } from "@/components/Toaster";

// Lives in the root layout so a study room (presence, chat, voice) stays connected
// while the user moves between pages.

export type Me = { id: string; name: string; email: string; color: string | null; icon: string | null };
export type Room = {
  id: string; space_id: string; title: string; goal: string | null; silent: boolean; chat_enabled: boolean;
  voice_enabled?: boolean; timer_minutes: number; timer_started_at: string | null; created_by: string; ended_at: string | null;
};
export type Message = { id: string; user_id: string; author: string; author_color?: string | null; author_icon?: string | null; body: string; created_at: string; mentions?: string[] | null };
export type Person = { id: string; name: string; color: string | null; icon: string | null; voice: boolean; muted: boolean };

type Ctx = {
  me: Me | null;
  setMe: (patch: Partial<Me>) => void;
  room: Room | null;
  people: Person[];
  messages: Message[];
  unread: number;
  markRead: () => void;
  chatVisible: (v: boolean) => void;
  join: (room: Room, messages?: Message[]) => void;
  leave: () => Promise<void>;
  send: (body: string, mentions?: string[]) => Promise<boolean | "blocked">;
  pokesMuted: boolean;
  setPokesMuted: (v: boolean) => void;
  setTimer: (running: boolean) => Promise<void>;
  remaining: number;
  voice: { joined: boolean; muted: boolean; connecting: boolean; join: () => Promise<void>; leave: () => void; toggleMute: () => void };
};

const RoomCtx = createContext<Ctx | null>(null);
// Inert stand-in for the rare render outside the provider (e.g. a dev-server first compile),
// so the sidebar or editor never crashes; real values arrive once the provider mounts.
const noop = () => {};
const OFFLINE: Ctx = {
  me: null, setMe: noop, room: null, people: [], messages: [], unread: 0, markRead: noop, chatVisible: noop,
  join: noop, leave: async () => {}, send: async () => false, setTimer: async () => {}, remaining: 0,
  pokesMuted: false, setPokesMuted: noop,
  voice: { joined: false, muted: false, connecting: false, join: async () => {}, leave: noop, toggleMute: noop },
};
export const useRoom = () => useContext(RoomCtx) ?? OFFLINE;

const STORE = "logia.activeRoom";
const ICE: RTCConfiguration = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };

export function RoomProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [me, setMeState] = useState<Me | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [unread, setUnread] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [voiceJoined, setVoiceJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const channel = useRef<RealtimeChannel | null>(null);
  const chatOpen = useRef(false);
  const meRef = useRef<Me | null>(null);
  meRef.current = me;
  const voiceRef = useRef({ joined: false, muted: false });
  voiceRef.current = { joined: voiceJoined, muted };

  // ── Signed-in profile (name + avatar) ──
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !alive) { setMeState(null); return; }
      let { data: prof, error } = await supabase.from("profiles").select("display_name, avatar_color, avatar_icon").eq("id", user.id).maybeSingle();
      if (error) ({ data: prof } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle() as any);
      const email = user.email ?? "";
      if (alive) setMeState({
        id: user.id, email,
        name: prof?.display_name || (user.user_metadata?.display_name as string) || email.split("@")[0] || "You",
        color: (prof as any)?.avatar_color ?? null, icon: (prof as any)?.avatar_icon ?? null,
      });
    };
    load();
    const { data: sub } = supabase.auth.onAuthStateChange((e) => { if (e === "SIGNED_IN" || e === "SIGNED_OUT" || e === "USER_UPDATED") load(); });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [supabase]);

  // ── Pokes: each user listens on their own channel; mentions notify them anywhere in Logia ──
  const router = useRouter();
  const [pokesMuted, setMutedState] = useState(false);
  const mutedRef = useRef(false);
  mutedRef.current = pokesMuted;
  useEffect(() => { try { setMutedState(localStorage.getItem("logia.pokes.muted") === "1"); } catch { /* */ } }, []);
  const setPokesMuted = useCallback((v: boolean) => {
    setMutedState(v);
    try { localStorage.setItem("logia.pokes.muted", v ? "1" : "0"); } catch { /* */ }
    toast(v ? "Pokes muted. You won't be notified when someone @mentions you." : "Pokes are back on.");
  }, []);

  useEffect(() => {
    if (!me?.id) return;
    const ch = supabase.channel(`poke:${me.id}`);
    ch.on("broadcast", { event: "poke" }, ({ payload }) => {
      if (mutedRef.current || !payload?.roomId) return;
      const p = payload as { from: string; roomId: string; spaceId: string; roomTitle: string; excerpt: string };
      const open = () => router.push(`/spaces/${p.spaceId}/rooms/${p.roomId}?chat=1`);
      toast(`${p.from} just poked you in ${p.roomTitle}: “${p.excerpt}”`, "poke", { label: "Open chat", run: open });
      if (document.visibilityState === "hidden" && "Notification" in window && Notification.permission === "granted") {
        const n = new Notification(`${p.from} just poked you`, { body: p.excerpt, tag: `poke-${p.roomId}` });
        n.onclick = () => { window.focus(); open(); n.close(); };
      }
    }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, me?.id, router]);

  const setMe = useCallback((patch: Partial<Me>) => setMeState((m) => (m ? { ...m, ...patch } : m)), []);

  // ── Voice (WebRTC mesh, signalled over the room channel) ──
  const local = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<string, { pc: RTCPeerConnection; makingOffer: boolean; audio: HTMLAudioElement }>());

  const signal = useCallback((to: string, data: Record<string, unknown>) => {
    channel.current?.send({ type: "broadcast", event: "rtc", payload: { to, from: meRef.current?.id, ...data } });
  }, []);

  const dropPeer = useCallback((id: string) => {
    const p = peers.current.get(id);
    if (!p) return;
    p.pc.close(); p.audio.srcObject = null; p.audio.remove();
    peers.current.delete(id);
  }, []);

  const peerFor = useCallback((id: string) => {
    const existing = peers.current.get(id);
    if (existing) return existing;
    const pc = new RTCPeerConnection(ICE);
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.setAttribute("playsinline", "");
    document.body.appendChild(audio);
    const entry = { pc, makingOffer: false, audio };
    peers.current.set(id, entry);
    local.current?.getTracks().forEach((t) => pc.addTrack(t, local.current!));
    pc.onicecandidate = (e) => { if (e.candidate) signal(id, { candidate: e.candidate.toJSON() }); };
    pc.ontrack = (e) => { audio.srcObject = e.streams[0] ?? new MediaStream([e.track]); audio.play().catch(() => {}); };
    pc.onnegotiationneeded = async () => {
      try { entry.makingOffer = true; await pc.setLocalDescription(); signal(id, { description: pc.localDescription?.toJSON() }); }
      catch { /* retried on next negotiation */ } finally { entry.makingOffer = false; }
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") pc.restartIce(); };
    return entry;
  }, [signal]);

  const onSignal = useCallback(async ({ from, to, description, candidate }: any) => {
    const mine = meRef.current?.id;
    if (!mine || to !== mine || !voiceRef.current.joined) return;
    const entry = peerFor(from);
    const pc = entry.pc;
    const polite = mine < from; // perfect negotiation: one side yields on offer collisions
    try {
      if (description) {
        const collision = description.type === "offer" && (entry.makingOffer || pc.signalingState !== "stable");
        if (!polite && collision) return;
        await pc.setRemoteDescription(description);
        if (description.type === "offer") { await pc.setLocalDescription(); signal(from, { description: pc.localDescription?.toJSON() }); }
      } else if (candidate) {
        await pc.addIceCandidate(candidate).catch(() => {});
      }
    } catch { /* stale signal */ }
  }, [peerFor, signal]);

  const track = useCallback(() => {
    const m = meRef.current;
    if (!m || !channel.current) return;
    channel.current.track({ name: m.name, color: m.color, icon: m.icon, voice: voiceRef.current.joined, muted: voiceRef.current.muted });
  }, []);

  const syncPeers = useCallback((list: Person[]) => {
    const mine = meRef.current?.id;
    if (!voiceRef.current.joined || !mine) return;
    const inVoice = new Set(list.filter((p) => p.voice && p.id !== mine).map((p) => p.id));
    for (const id of [...peers.current.keys()]) if (!inVoice.has(id)) dropPeer(id);
    for (const id of inVoice) peerFor(id);
  }, [dropPeer, peerFor]);

  const stopVoice = useCallback(() => {
    for (const id of [...peers.current.keys()]) dropPeer(id);
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
    voiceRef.current = { joined: false, muted: false };
    setVoiceJoined(false); setMuted(false);
  }, [dropPeer]);

  // ── Room channel: presence + timer + chat + voice signalling ──
  useEffect(() => {
    if (!room?.id || !me?.id) return;
    const ch = supabase.channel(`room:${room.id}`, { config: { presence: { key: me.id }, broadcast: { self: false } } });
    channel.current = ch;
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<{ name: string; color: string | null; icon: string | null; voice: boolean; muted: boolean }>();
      const list: Person[] = Object.entries(state).map(([id, metas]) => {
        const m = metas[metas.length - 1];
        return { id, name: safeRemoteText(m?.name, "Student") || "Student", color: m?.color ?? null, icon: m?.icon ?? null, voice: !!m?.voice, muted: !!m?.muted };
      });
      list.sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : a.name.localeCompare(b.name)));
      setPeople(list);
      syncPeers(list);
    })
      .on("broadcast", { event: "rtc" }, ({ payload }) => onSignal(payload))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "study_rooms", filter: `id=eq.${room.id}` },
        (p) => setRoom((r) => (r ? { ...r, ...(p.new as Room) } : r)))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "room_messages", filter: `room_id=eq.${room.id}` },
        (p) => {
          const m = p.new as Message;
          if (hasBlockedWord(m.body)) return; // a modified sender cannot get a blocked message shown here
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          if (!chatOpen.current && m.user_id !== me.id) setUnread((u) => u + 1);
        })
      .subscribe((status) => { if (status === "SUBSCRIBED") track(); });
    return () => { channel.current = null; supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, room?.id, me?.id]);

  // Re-announce when avatar/name/voice state changes.
  useEffect(() => { track(); }, [me?.name, me?.color, me?.icon, voiceJoined, muted, track]);

  // Rejoin the last room after a full reload (voice needs a fresh click, browsers require it).
  useEffect(() => {
    if (!me?.id || room) return;
    let saved: { id: string } | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(STORE) || "null"); } catch { /* storage blocked */ }
    if (!saved?.id) return;
    (async () => {
      const [{ data: r }, { data: msgs }] = await Promise.all([
        supabase.from("study_rooms").select("*").eq("id", saved!.id).is("ended_at", null).maybeSingle(),
        supabase.from("room_messages").select("*").eq("room_id", saved!.id).order("created_at").limit(200),
      ]);
      if (r) { setRoom(r as Room); setMessages((msgs ?? []) as Message[]); }
      else try { sessionStorage.removeItem(STORE); } catch { /* */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  const join = useCallback((r: Room, msgs: Message[] = []) => {
    setRoom((cur) => {
      if (cur?.id === r.id) return { ...cur, ...r };
      stopVoice();
      setMessages(msgs); setUnread(0); setPeople([]);
      return r;
    });
    try { sessionStorage.setItem(STORE, JSON.stringify({ id: r.id })); } catch { /* */ }
  }, [stopVoice]);

  const leave = useCallback(async () => {
    const r = room;
    stopVoice();
    if (r && me && r.created_by === me.id && people.length <= 1 && window.confirm("You're the last one here. Close the room for everyone?")) {
      await endRoom(r.space_id, r.id);
    }
    setRoom(null); setPeople([]); setMessages([]); setUnread(0);
    try { sessionStorage.removeItem(STORE); } catch { /* */ }
  }, [room, me, people.length, stopVoice]);

  const send = useCallback(async (body: string, mentions: string[] = []) => {
    if (!room || !me) return false;
    if (hasBlockedWord(body)) return "blocked";
    const res = await sendRoomMessage(room.id, { name: me.name, color: me.color, icon: me.icon }, body, mentions);
    if ("blocked" in res && res.blocked) return "blocked";
    if ("error" in res && res.error) { toast(res.error, "error"); return false; }
    // Poke everyone mentioned, wherever they are in Logia.
    const excerpt = body.replace(/\s+/g, " ").slice(0, 90);
    for (const uid of ("mentions" in res && res.mentions) || []) {
      const ch = supabase.channel(`poke:${uid}`);
      ch.subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        ch.send({ type: "broadcast", event: "poke", payload: { from: me.name.split(/\s+/)[0], roomId: room.id, spaceId: room.space_id, roomTitle: room.title, excerpt } })
          .finally(() => supabase.removeChannel(ch));
      });
    }
    // Ask once for browser notifications so pokes reach people on other tabs.
    if ("Notification" in window && Notification.permission === "default" && mentions.length) Notification.requestPermission().catch(() => {});
    return true;
  }, [room, me, supabase]);

  const setTimer = useCallback(async (running: boolean) => {
    if (!room) return;
    setRoom((r) => (r ? { ...r, timer_started_at: running ? new Date().toISOString() : null } : r));
    setNow(Date.now());
    const res = await setRoomTimer(room.id, running);
    if ("error" in res && res.error) toast(res.error, "error");
  }, [room]);

  // Shared countdown, derived from the same start time for everyone.
  useEffect(() => {
    if (!room?.timer_started_at) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [room?.timer_started_at]);
  const total = (room?.timer_minutes ?? 0) * 60;
  const remaining = room?.timer_started_at
    ? Math.max(0, total - Math.floor((now - new Date(room.timer_started_at).getTime()) / 1000))
    : total;

  const joinVoice = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) { toast("Voice chat isn't supported in this browser.", "error"); return; }
    setConnecting(true);
    try {
      local.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      voiceRef.current = { joined: true, muted: false };
      setVoiceJoined(true); setMuted(false);
      syncPeers(people);
    } catch {
      toast("Microphone access was blocked. Allow it in your browser's site settings, then try again.", "error");
    } finally { setConnecting(false); }
  }, [people, syncPeers]);

  const toggleMute = useCallback(() => {
    const next = !voiceRef.current.muted;
    local.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
    voiceRef.current = { ...voiceRef.current, muted: next };
    setMuted(next);
  }, []);

  useEffect(() => () => stopVoice(), [stopVoice]);

  const value: Ctx = {
    me, setMe, room, people, messages: messages.filter((m) => !hasBlockedWord(m.body)), unread,
    markRead: () => setUnread(0),
    chatVisible: (v) => { chatOpen.current = v; if (v) setUnread(0); },
    join, leave, send, setTimer, remaining, pokesMuted, setPokesMuted,
    voice: { joined: voiceJoined, muted, connecting, join: joinVoice, leave: stopVoice, toggleMute },
  };
  return <RoomCtx.Provider value={value}>{children}</RoomCtx.Provider>;
}
