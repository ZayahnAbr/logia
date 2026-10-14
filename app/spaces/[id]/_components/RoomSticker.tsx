"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getPhase, formatClock } from "@/lib/cafeClock";
import type { RoomInfo } from "./StickerLayer";

// A live room on the space home: its moving scene, the shared timer as it runs right now, and a way in.
export function RoomStickerBody({ room }: { room: RoomInfo }) {
  const [now, setNow] = useState<number | null>(null);
  const [motion, setMotion] = useState(true);
  useEffect(() => {
    setMotion(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const ph = now ? getPhase({ focus_minutes: room.focus, break_minutes: room.brk, anchor: room.anchor }, now) : null;

  return (
    <div className="rs" data-phase={ph?.phase} style={{ width: "100%" }}>
      <div className="rs-scene" style={room.color ? { background: room.color } : room.poster ? { backgroundImage: `url(${room.poster})` } : undefined} aria-hidden="true">
        {room.video && motion && <video className="rs-video" src={room.video} poster={room.poster ?? undefined} autoPlay muted loop playsInline />}
      </div>
      <div className="rs-over">
        <span className="rs-name">{room.name}</span>
        <span className="rs-time" role="timer" aria-label={ph ? `${ph.phase === "focus" ? "Focus" : "Break"}, ${formatClock(ph.remainingSec)} left` : "Timer"}>
          <small>{ph ? (ph.phase === "focus" ? "Focus" : "Break") : " "}</small>
          {ph ? formatClock(ph.remainingSec) : "--:--"}
        </span>
        <Link href={room.href} className="rs-join">Join <ArrowUpRight size={13} aria-hidden="true" /></Link>
      </div>
    </div>
  );
}
