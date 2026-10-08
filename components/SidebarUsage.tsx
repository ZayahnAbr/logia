"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getAiAllowance } from "@/app/growth-actions";

type A = Awaited<ReturnType<typeof getAiAllowance>>;

// Always-visible AI usage, like Claude's usage meter. Refreshes every minute.
export function SidebarUsage() {
  const [a, setA] = useState<A>(null);
  useEffect(() => {
    let alive = true;
    const load = () => getAiAllowance().then((x) => alive && setA(x)).catch(() => {});
    load();
    const t = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  if (!a) return null;
  if (!a.unlimited && a.pro) return null; // Pro students see no meter
  if (a.unlimited) return <Link href="/spaces/settings#ai" className="su"><span className="su-top"><span>AI usage</span><b>Unlimited</b></span></Link>;
  const left = 100 - a.pct;
  const refill = a.refillAt ? new Date(a.refillAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  const when = a.window === "day" ? "today" : a.window === "hour" ? "this hour" : "this minute";
  const sub = a.pct === 0 ? "Refills every hour" : a.window === "day" ? "Back tomorrow morning" : refill ? `Back by ${refill}` : "Refills soon";
  return (
    <Link href="/spaces/settings#ai" className={`su${a.pct >= 90 ? " low" : ""}`} aria-label={`${left}% of ${when}'s AI left`}>
      <span className="su-top"><span>AI left {when}</span><b>{left}%</b></span>
      <span className="su-bar" aria-hidden="true"><i style={{ width: `${left}%` }} /></span>
      <span className="su-sub">{sub}{a.bonusHours > 0 ? ` · +${a.bonusHours}h bonus` : ""}</span>
    </Link>
  );
}
