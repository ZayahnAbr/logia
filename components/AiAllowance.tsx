import Link from "next/link";
import { Sparkles } from "lucide-react";
import { getAiAllowance } from "@/app/growth-actions";

// How much of this hour's AI is used, when it refills, and any bonus time. Never raw tokens.
export async function AiAllowance() {
  const a = await getAiAllowance();
  if (!a) return null;
  if (a.unlimited) {
    return (
      <div className="card ai-allow">
        <h2 className="sec-title" style={{ margin: 0 }}>AI allowance</h2>
        <p className="ai-allow-sub"><Sparkles size={14} aria-hidden="true" /> Unlimited on this account.</p>
      </div>
    );
  }
  if (a.pro) {
    const renews = a.until ? new Date(a.until).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" }) : null;
    return (
      <div className="card ai-allow">
        <h2 className="sec-title" style={{ margin: 0 }}>Logia Pro</h2>
        <p className="ai-allow-sub"><Sparkles size={14} aria-hidden="true" /> You&apos;re on Logia Pro.{renews ? ` Your plan runs until ${renews}.` : ""}</p>
      </div>
    );
  }
  const refill = a.refillAt ? new Date(a.refillAt).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" }) : null;
  const state = a.pct >= 100 ? "Used up for now" : a.pct >= 75 ? "Running low" : "Plenty left";
  return (
    <div className="card ai-allow">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 className="sec-title" style={{ margin: 0 }}>AI allowance {a.window === "day" ? "today" : a.window === "hour" ? "this hour" : "this minute"}</h2>
        <span style={{ fontSize: 13, fontWeight: 600, color: a.pct >= 100 ? "var(--danger)" : a.pct >= 75 ? "var(--warning)" : "var(--success)" }}>{state}</span>
      </div>
      <div className="ai-meter" role="meter" aria-label={`AI used ${a.window === "day" ? "today" : a.window === "hour" ? "this hour" : "this minute"}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={a.pct} aria-valuetext={`${a.pct}% used`}>
        <span style={{ width: `${a.pct}%` }} />
      </div>
      <p className="ai-allow-sub">
        {a.pct}% used.{a.pct === 0 ? " It refills every hour." : a.window === "day" ? " It is back tomorrow morning." : refill ? ` It is back by ${refill}.` : ""}
        {a.bonusHours > 0 && ` You also have about ${a.bonusHours} ${a.bonusHours === 1 ? "hour" : "hours"} of bonus AI time.`}
      </p>
      <p className="ai-allow-sub"><Link href="/invite" className="site-link">Invite a friend</Link> for bonus AI time, or see <Link href="/pricing" className="site-link">Logia Pro</Link> for no waiting at busy times.</p>
    </div>
  );
}
