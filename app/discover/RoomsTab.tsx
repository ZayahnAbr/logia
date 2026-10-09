"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CafeScene } from "@/components/CafeScene";
import { Avatar } from "@/components/Avatar";
import { getPhase, formatClock } from "@/lib/cafeClock";
import { STATUS_LABEL, type UserCafeCard } from "@/lib/userCafes";
import type { PublicRoom } from "./rooms/[slug]/CafeRoom";

type Phase = ReturnType<typeof getPhase> | null;

function Meta({ ph, n }: { ph: Phase; n: number }) {
  return (
    <div className="dc-meta">
      <span className={`dc-phase ${ph?.phase ?? ""}`}>{ph ? `${ph.phase === "focus" ? "Focus" : "Break"} · ${formatClock(ph.remainingSec)} left` : "Loading"}</span>
      {n > 0 ? <span className="dc-count"><Users size={14} aria-hidden="true" /> {n} here</span> : <span className="dc-count">Be the first in</span>}
    </div>
  );
}

// The loop itself is the thumbnail: a card plays whenever it is on screen, and pauses off screen
// to save battery and data. Phone feed (under 761px): only the card filling the screen plays.
// Never under reduced motion (poster only).
function useCardPlay() {
  const ref = useRef<HTMLLIElement>(null);
  const [visible, setVisible] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 760px)"), r = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => { setMobile(m.matches); setReduced(r.matches); };
    sync();
    m.addEventListener("change", sync); r.addEventListener("change", sync);
    return () => { m.removeEventListener("change", sync); r.removeEventListener("change", sync); };
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const need = mobile ? 0.6 : 0.2;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting && e.intersectionRatio >= need), { threshold: [0, 0.2, 0.6, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, [mobile]);
  const play = !reduced && visible;
  const handlers = {};
  return { ref, play, handlers };
}

function Card({ children }: { children: (play: boolean) => React.ReactNode }) {
  const { ref, play, handlers } = useCardPlay();
  return <li ref={ref} className="card dc-card" {...handlers}>{children(play)}</li>;
}

export function RoomsTab({ rooms, hosted: allHosted, mine }: { rooms: PublicRoom[]; hosted: UserCafeCard[]; mine: UserCafeCard[] }) {
  const supabase = useMemo(() => createClient(), []);
  const hosted = useMemo(() => allHosted.filter((h) => !mine.some((m) => m.id === h.id)), [allHosted, mine]);
  const sections = hosted.length > 0 || mine.length > 0;
  const Name = sections ? "h3" : "h2";
  const [now, setNow] = useState<number | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Listen-only presence on each room's channel (we never track here), so the count is live.
  useEffect(() => {
    const names = new Set<string>([...rooms.map((r) => `cafe:${r.slug}`), ...hosted.map((c) => `ucafe:${c.id}`), ...mine.map((c) => `ucafe:${c.id}`)]);
    const chans = [...names].map((name) => {
      const ch = supabase.channel(name);
      ch.on("presence", { event: "sync" }, () => setCounts((c) => ({ ...c, [name]: Object.keys(ch.presenceState()).length }))).subscribe();
      return ch;
    });
    return () => { chans.forEach((c) => supabase.removeChannel(c)); };
  }, [supabase, rooms, hosted, mine]);

  if (rooms.length === 0 && hosted.length === 0 && mine.length === 0) {
    return <div className="empty card" style={{ padding: "32px 20px" }}>No live rooms are open right now. Host one yourself, or check back soon.</div>;
  }

  const userCard = (c: UserCafeCard, own: boolean) => {
    const ph = now === null ? null : getPhase(c, now);
    const hostName = c.host?.display_name || "A student";
    return (
      <Card key={`${own ? "m" : "h"}-${c.id}`}>{(play) => (<>
        <div className="dc-preview">{c.coverUrl
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
          ? <img className="ce-cardimg" src={c.coverUrl} alt={`Cover picture for ${c.name}`} loading="lazy" />
          : <CafeScene play={play} scene={c.loop_preset ?? "rainforest"} src={c.loop_kind === "upload" ? c.loopUrl ?? undefined : undefined} image={c.loop_kind === "image" ? c.loopUrl ?? undefined : undefined} color={c.loop_kind === "color" ? c.bg_color ?? undefined : undefined} />}</div>
        <div className="dc-body">
          {own && <span className={`dc-status st-${c.status}`}>{STATUS_LABEL[c.status]}</span>}
          <Name className="dc-name">{c.name}</Name>
          <div className="dc-host">
            <Avatar name={hostName} color={c.host?.avatar_color ?? null} icon={c.host?.avatar_icon ?? null} size={20} />
            <span className="truncate">{own ? "You" : `Hosted by ${hostName}`}</span>
          </div>
          {c.description && <p className="dc-desc">{c.description}</p>}
          <Meta ph={ph} n={counts[`ucafe:${c.id}`] ?? 0} />
          <div className="dc-sub">{c.focus_minutes} min focus, {c.break_minutes} min break</div>
          <Link href={`/discover/c/${c.id}`} className="btn btn-primary" style={{ marginTop: 12 }} aria-label={`${own ? "Open" : "Join"} ${c.name}`}>{own ? "Open" : "Join"}</Link>
        </div>
      </>)}</Card>
    );
  };

  return (
    <ul className="dc-grid" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {mine.length > 0 && <li className="dc-section"><h2 className="dc-h2">Your rooms</h2></li>}
      {mine.map((c) => userCard(c, true))}
      {sections && rooms.length > 0 && <li className="dc-section"><h2 className="dc-h2">Logia rooms</h2></li>}
      {rooms.map((r) => {
        const ph = now === null ? null : getPhase(r, now);
        return (
          <Card key={r.id}>{(play) => (<>
            <div className="dc-preview"><CafeScene scene={r.scene} play={play} /></div>
            <div className="dc-body">
              <Name className="dc-name">{r.name}</Name>
              <Meta ph={ph} n={counts[`cafe:${r.slug}`] ?? 0} />
              <div className="dc-sub">{r.focus_minutes} min focus, {r.break_minutes} min break</div>
              <Link href={`/discover/rooms/${r.slug}`} className="btn btn-primary" style={{ marginTop: 12 }} aria-label={`Join ${r.name}`}>Join</Link>
            </div>
          </>)}</Card>
        );
      })}
      {hosted.length > 0 && <li className="dc-section"><h2 className="dc-h2">Hosted by students</h2></li>}
      {hosted.map((c) => userCard(c, false))}
    </ul>
  );
}
