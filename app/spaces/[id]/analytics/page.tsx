import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import "../../../workspace-layout.css";
import { Flame, Clock, Layers, Target, FileCheck2, ArrowUpRight } from "lucide-react";
import { getSpace, getStudyAnalytics } from "@/lib/queries";

export default async function AnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [space, data] = await Promise.all([getSpace(id), getStudyAnalytics(id)]);

  const stats = [
    { label: "Study hours",     value: data ? (data.totalMinutes / 60).toFixed(1) : "0", hint: "Focus sessions logged in this space", icon: Clock,  color: "var(--accent-text)" },
    { label: "Cards reviewed",  value: data ? data.cardsReviewed.toString() : "0", hint: "Total reviews across your flashcards", icon: Layers, color: "var(--emerald)" },
    { label: "Day streak",      value: data ? data.streak.toString() : "0", hint: "Days in a row with study activity", icon: Flame,  color: "var(--amber)" },
    { label: "Average mastery", value: data && data.cardsReviewed ? `${Math.round(data.avgMastery * 100)}%` : "-", hint: "How long you tend to remember each card", icon: Target, color: "var(--coral)" },
  ];
  const topics = data?.topics ?? [];
  const tone = (a: number) => (a < 0.5 ? "var(--destructive)" : a < 0.75 ? "var(--amber)" : "var(--emerald)");

  return (
    <div className="wk-progress">
      <div className="phead phead-grad">
        <div className="eyebrow">{space?.name}</div>
        <h1>Progress</h1>
        <div className="sub">Streaks, review stats, and the topics worth another look.</div>
      </div>

      <div className="wk-tiles">
        {stats.map((s) => (
          <div key={s.label} className="card wk-tile">
            <span className="wk-tile-top"><s.icon size={16} aria-hidden="true" style={{ color: s.color }} /> {s.label}</span>
            <p className="wk-tile-num">{s.value}</p>
            <p className="wk-tile-hint">{s.hint}</p>
          </div>
        ))}
      </div>

      <div className="wk-progress-cols">
        <section className="card wk-panel" aria-labelledby="weak-h">
          <div className="wk-panel-head">
            <h2 id="weak-h" className="wk-h2" style={{ margin: 0 }}>Weakest topics</h2>
            <ul className="wk-legend" aria-label="Colour key">
              <li><i style={{ background: "var(--destructive)" }} /> Under 50%</li>
              <li><i style={{ background: "var(--amber)" }} /> 50 to 74%</li>
              <li><i style={{ background: "var(--emerald)" }} /> 75% and up</li>
            </ul>
          </div>
          {topics.length === 0 ? (
            <div className="wk-empty wk-empty-flat">
              <strong>Nothing to show yet</strong>
              <p>Answer questions from a marked past paper and each topic appears here as a bar, weakest first, so you know what to revise.</p>
              <div className="wk-ghost" aria-hidden="true">
                {[72, 48, 28].map((w) => <div key={w}><span /><i><b style={{ width: `${w}%` }} /></i></div>)}
              </div>
              <Link href={`/spaces/${id}/papers`} className="btn btn-primary btn-sm">Open past papers</Link>
            </div>
          ) : (
            <ul className="wk-topics">
              {topics.map((t) => (
                <li key={t.topic}>
                  <div className="wk-topic-row"><span className="truncate">{t.topic}</span><span>{Math.round(t.accuracy * 100)}% <small>· {t.attempts} attempt{t.attempts === 1 ? "" : "s"}</small></span></div>
                  <div className="wk-bar" role="img" aria-label={`${t.topic}: ${Math.round(t.accuracy * 100)} percent correct`}><i style={{ width: `${Math.round(t.accuracy * 100)}%`, background: tone(t.accuracy) }} /></div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="card wk-next" aria-label="Where to go next">
          <h2 className="wk-h2">Keep going</h2>
          <Link href={`/spaces/${id}/decks`}><Layers size={15} aria-hidden="true" /> Review flashcards <ArrowUpRight size={14} aria-hidden="true" /></Link>
          <Link href={`/spaces/${id}/pain-points`}><Flame size={15} aria-hidden="true" /> Work on pain points <ArrowUpRight size={14} aria-hidden="true" /></Link>
          <Link href={`/spaces/${id}/papers`}><FileCheck2 size={15} aria-hidden="true" /> Mark a past paper <ArrowUpRight size={14} aria-hidden="true" /></Link>
        </aside>
      </div>
    </div>
  );
}
