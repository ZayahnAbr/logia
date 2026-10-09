import { redirect } from "next/navigation";
import Link from "next/link";
import "../workspace-layout.css";
import { createClient } from "@/lib/supabase/server";
import { getMySpaces, getDashboardData, getSpaceStats, getSpaceCovers } from "@/lib/queries";
import { SpaceCover } from "./_components/SpaceCover";
import { COVER_COLORS } from "@/lib/coverColors";
import { NewSpaceTile } from "./_components/NewSpaceTile";
import { CalendarWidget } from "@/components/CalendarWidget";
import { TimetableWidget } from "@/components/TimetableWidget";
import { SchoolSyncList } from "@/components/SchoolSyncList";
import { AppShell } from "@/components/AppShell";
import { BookCover } from "@/components/BookCover";
import { ReferralClaimer } from "@/components/site/Referral";
import { DepthStage } from "@/components/motion";
import { ArrowUpRight, Layers, GraduationCap, Users, Flame, FileCheck2, Timer, Target, CalendarCheck, ListChecks } from "lucide-react";

const TONES = ["var(--blush)", "var(--peach)", "var(--powder)", "var(--warm)", "var(--blush-deep)"];

export default async function SpacesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");

  // Independent reads, fetched together. Persona is separate so a missing column can't break the page.
  const [{ data: prof }, { data: personaRow }, spaces, dash] = await Promise.all([
    supabase.from("profiles").select("display_name, onboarding_completed").eq("id", user.id).single(),
    supabase.from("profiles").select("persona").eq("id", user.id).maybeSingle(),
    getMySpaces(),
    getDashboardData(user.id),
  ]);
  const name = prof?.display_name || user.email?.split("@")[0] || "there";
  const spaceName = Object.fromEntries(spaces.map((s) => [s.id, s.name]));

  const emptyCard = (text: string) => <div className="empty card" style={{ padding: "28px 20px" }}>{text}</div>;
  const rowLink = { display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", minWidth: 0 } as const;

  const [stats, covers] = await Promise.all([getSpaceStats(user.id, spaces.map((x) => x.id)), getSpaceCovers(user.id)]);
  const totalDue = Object.values(stats).reduce((n, x) => n + x.due, 0);
  const busiest = [...spaces].sort((x, y) => (stats[y.id]?.due ?? 0) - (stats[x.id]?.due ?? 0))[0];

  // One state-aware "next step" so the dashboard always answers "what should I do now?"
  const first = spaces[0];
  const nextStep = !first
    ? { title: "Create your first space", body: "A space holds one module: its notes, flashcards, papers and AI help. Start one below, or join a classmate's with their invite code.", href: "#create-space", cta: "Create a space" }
    : dash.pains[0]
    ? { title: `Fix a weak spot: ${dash.pains[0].title}`, body: "You've slipped on this more than once. A few minutes on it now pays off in the exam.", href: `/spaces/${dash.pains[0].space_id}/pain-points`, cta: "Review pain points" }
    : dash.books[0]
    ? { title: `Pick up ${dash.books[0].title}`, body: `You stopped on page ${dash.books[0].last_page}. Your highlights and bookmarks are saved.`, href: `/library/${dash.books[0].id}`, cta: "Continue reading" }
    : dash.papers.length === 0
    ? { title: `Mark a past paper in ${first.name}`, body: "Upload an answered paper and its memo. Logia shows where you lost marks and saves the weak topics as pain points.", href: `/spaces/${first.id}/papers`, cta: "Upload a paper" }
    : { title: `Test yourself in ${first.name}`, body: "Review your flashcards and answer out loud. Logia checks what you remembered and what you missed.", href: `/spaces/${first.id}/decks`, cta: "Open flashcards" };

  return (
    <AppShell showTour={!prof?.onboarding_completed} askPersona={personaRow !== null && !personaRow.persona}>
      <ReferralClaimer />
      <div>
        {/* Landing-style hero: greeting + the one next step, with live planes of the student's own state */}
        <DepthStage className="dash-hero mesh-warm">
          <div className="dash-hero-copy" data-depth="0.1">
            <p className="eyebrow" style={{ color: "rgba(17,17,17,.66)", margin: 0 }}>Welcome back, {name}</p>
            <h1 className="dash-hero-h">{nextStep.title}</h1>
            <p className="dash-hero-p">{nextStep.body}</p>
            <div className="l-actions" style={{ marginTop: 24 }}>
              <Link href={nextStep.href} className="btn btn-primary btn-lg">{nextStep.cta}</Link>
              {first && <Link href={`/spaces/${first.id}`} className="btn btn-lg l-btn-soft">Open {first.name}</Link>}
            </div>
          </div>
          <div className="dash-hero-art" aria-hidden="true">
            <div className="l-plane dash-p-streak" data-depth="1.2">
              <span className="dash-flame"><Flame size={20} aria-hidden="true" /></span>
              <span><b>{dash.week.streak}</b> day streak</span>
            </div>
            {dash.books[0] ? (
              <div className="l-plane dash-p-book" data-depth="0.7">
                <BookCover title={dash.books[0].title} url={dash.books[0].cover_url} width={74} />
                <span style={{ minWidth: 0 }}>
                  <small>Reading</small>
                  <strong className="truncate" style={{ display: "block" }}>{dash.books[0].title}</strong>
                  <span className="dash-mini-bar"><i style={{ width: `${dash.books[0].page_count ? Math.round((dash.books[0].last_page / dash.books[0].page_count) * 100) : 0}%` }} /></span>
                </span>
              </div>
            ) : (
              <div className="l-plane dash-p-book" data-depth="0.7">
                <span className="dash-p-ico"><Layers size={18} /></span>
                <span><small>This week</small><strong>{dash.week.answered} answers checked</strong></span>
              </div>
            )}
            <div className="l-plane dash-p-acc" data-depth="1.6">
              <span className="l-ring" style={{ ["--v" as string]: dash.week.accuracy ?? 0 }}><span>{dash.week.accuracy === null ? "-" : `${dash.week.accuracy}%`}</span></span>
              <span><small>Accuracy</small><strong>this week</strong></span>
            </div>
            <div className="l-plane dash-p-spaces" data-depth="0.4">
              <span className="dash-stack">{spaces.slice(0, 4).map((sp, i) => <i key={sp.id} style={{ background: TONES[i % TONES.length] }}>{sp.name.slice(0, 1).toUpperCase()}</i>)}{spaces.length === 0 && <i style={{ background: TONES[0] }}>+</i>}</span>
              <span>{spaces.length ? `${spaces.length} space${spaces.length === 1 ? "" : "s"}` : "No spaces yet"}</span>
            </div>
          </div>
        </DepthStage>

        <div className="db">
          {/* Today: what needs you now, above the spaces */}
          <section className="db-band db-top" aria-label="Today">
            <section className="card db-today">
              <p className="eyebrow">Today</p>
              <div className="db-today-num"><b>{totalDue}</b><span>card{totalDue === 1 ? "" : "s"} to review</span></div>
              {busiest && totalDue > 0
                ? <Link href={`/spaces/${busiest.id}/decks`} className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>Review {busiest.name}</Link>
                : <p className="db-sub">You&apos;re all caught up. New cards appear here when they&apos;re due.</p>}
              <dl className="db-mini">
                <div><dt><Flame size={13} aria-hidden="true" /> Streak</dt><dd>{dash.week.streak}d</dd></div>
                <div><dt><Target size={13} aria-hidden="true" /> Accuracy</dt><dd>{dash.week.accuracy === null ? "-" : `${dash.week.accuracy}%`}</dd></div>
                <div><dt><Timer size={13} aria-hidden="true" /> Focus</dt><dd>{Math.round(dash.week.focusMinutes / 6) / 10}h</dd></div>
              </dl>
            </section>

            <CalendarWidget compact hideLms />
            <TimetableWidget />
            <SchoolSyncList />
          </section>

          {/* Spaces gallery: the main thing on the page */}
          <section className="db-main" aria-labelledby="db-spaces">
            <div className="db-head">
              <h2 id="db-spaces">Your spaces</h2>
              <span>{spaces.length ? `${spaces.length} module${spaces.length === 1 ? "" : "s"}` : "Start with one module"}</span>
            </div>
            <ul className="sp-grid" data-tour="spaces-list">
              {spaces.map((sp, i) => {
                const st = stats[sp.id] ?? { decks: 0, cards: 0, due: 0, notes: 0 };
                return (
                  <li key={sp.id} className="sp-card">
                    <Link href={`/spaces/${sp.id}`} className="stretched" aria-label={`Open ${sp.name}`} />
                    <SpaceCover spaceId={sp.id} initial={covers[sp.id] ?? COVER_COLORS[i % COVER_COLORS.length]}>
                      <span className="sp-kind">{sp.type === "peer" ? <Users size={12} /> : <GraduationCap size={12} />} {sp.type === "peer" ? "Study space" : "Class hub"}</span>
                      {st.due > 0 && <span className="sp-due">{st.due} due</span>}
                    </SpaceCover>
                    <div className="sp-body">
                      <h3 className="truncate" title={sp.name}>{sp.name}</h3>
                      <p className="truncate">{sp.subject || "No subject set"}</p>
                      <dl className="sp-stats">
                        <div><dt>Decks</dt><dd>{st.decks}</dd></div>
                        <div><dt>Cards</dt><dd>{st.cards}</dd></div>
                        <div><dt>Notes</dt><dd>{st.notes}</dd></div>
                      </dl>
                    </div>
                    <div className="sp-foot">
                      <span className="mono" title="Invite code">{sp.invite_code}</span>
                      <ArrowUpRight size={16} aria-hidden="true" />
                    </div>
                  </li>
                );
              })}
              <li><NewSpaceTile first={spaces.length === 0} /></li>
            </ul>
          </section>

          {/* Below the spaces: weak spots, reading, recent papers */}
          <section className="db-band db-bottom" aria-label="More for you">

            {dash.pains.length > 0 && (
              <section className="card db-panel">
                <h2>Weak spots</h2>
                <ul>
                  {dash.pains.slice(0, 4).map((p) => (
                    <li key={p.id}>
                      <Link href={`/spaces/${p.space_id}/pain-points`} className="db-row">
                        <span className="db-dot" style={{ background: p.hits >= 3 ? "var(--danger)" : "var(--warning)" }} aria-hidden="true" />
                        <span style={{ minWidth: 0, flex: 1 }}><span className="truncate" style={{ display: "block", fontWeight: 600 }}>{p.title}</span><small>{spaceName[p.space_id] ?? "Space"} · {p.hits}× seen</small></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {dash.books.length > 0 && (
              <section className="card db-panel">
                <h2>Continue reading</h2>
                <div className="db-books">
                  {dash.books.slice(0, 3).map((bk) => (
                    <Link key={bk.id} href={`/library/${bk.id}`} title={bk.title}>
                      <BookCover title={bk.title} url={bk.cover_url} width={78} />
                      <small>{bk.page_count ? `${Math.round((bk.last_page / bk.page_count) * 100)}%` : "Open"}</small>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {dash.papers.length > 0 && (
              <section className="card db-panel">
                <h2>Recently marked</h2>
                <ul>
                  {dash.papers.slice(0, 3).map((p) => (
                    <li key={p.id}>
                      <Link href={`/spaces/${p.space_id}/papers/${p.id}`} className="db-row">
                        <FileCheck2 size={15} aria-hidden="true" style={{ color: "var(--accent-text)", flexShrink: 0 }} />
                        <span style={{ minWidth: 0, flex: 1 }}><span className="truncate" style={{ display: "block", fontWeight: 600 }}>{p.title}</span><small>{spaceName[p.space_id] ?? "Space"}</small></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </section>

        </div>
      </div>
    </AppShell>
  );
}
