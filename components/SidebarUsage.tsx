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
  // Calm wording on purpose: a status, not a countdown. Only shows a bar and a time when the assistant needs a rest.
  const resting = left <= 10;
  const status = resting ? "Resting" : left <= 40 ? "Going steady" : "Ready";
  const sub = !resting ? null : a.window === "day" ? "Back tomorrow morning" : refill ? `Back around ${refill}` : "Back shortly";
  return (
    <Link href="/spaces/settings#ai" className={`su${resting ? " low" : ""}`} aria-label={`Study assistant: ${status.toLowerCase()}`}>
      <span className="su-top"><span>Study assistant</span><b>{status}</b></span>
      {resting && <span className="su-bar" aria-hidden="true"><i style={{ width: `${Math.max(left, 4)}%` }} /></span>}
      {sub && <span className="su-sub">{sub}{a.bonusHours > 0 ? " · bonus time added" : ""}</span>}
    </Link>
  );
}
