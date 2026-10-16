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
import { FileCheck2 } from "lucide-react";

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
  // Short headline (its last word is the italic accent) with the specifics in the sentence below.
  const nextStep = !first
    ? { title: "Create your first space", body: "A space holds one module: its notes, flashcards, papers and study help. Start one below, or join a classmate's with their invite code.", href: "#create-space", cta: "Create a space" }
    : dash.pains[0]
    ? { title: "Fix a weak spot", body: `${dash.pains[0].title}. You've slipped on this more than once. A few minutes on it now pays off in the exam.`, href: `/spaces/${dash.pains[0].space_id}/pain-points`, cta: "Review pain points" }
    : dash.books[0]
    ? { title: "Pick up your reading", body: `${dash.books[0].title.replace(/[_]+/g, " ").trim().slice(0, 70)}. You stopped on page ${dash.books[0].last_page}. Your highlights and bookmarks are saved.`, href: `/library/${dash.books[0].id}`, cta: "Continue reading" }
    : dash.papers.length === 0
    ? { title: "Mark a past paper", body: `In ${first.name}: upload an answered paper and its memo. Logia shows where you lost marks and saves the weak topics as pain points.`, href: `/spaces/${first.id}/papers`, cta: "Upload a paper" }
    : { title: "Test yourself today", body: `In ${first.name}: review your flashcards and answer out loud. Logia checks what you remembered and what you missed.`, href: `/spaces/${first.id}/decks`, cta: "Open flashcards" };

  return (
    <AppShell showTour={!prof?.onboarding_completed} askPersona={personaRow !== null && !personaRow.persona}>
      <ReferralClaimer />
      <div className="hm">
        {/* Hero: greeting + the one next step, with live planes of the student's own state */}
        <div className="dash-hero dash-hero-quiet mesh-warm">
          <div className="dash-hero-copy">
            <h1 className="dash-hero-h"><span className="hm-hi">Welcome back,</span> <em className="serif">{name.split(" ")[0]}</em></h1>
            <p className="dash-hero-lead">{nextStep.title}</p>
            <p className="dash-hero-p">{nextStep.body}</p>
            <div className="l-actions" style={{ marginTop: 20 }}>
              <Link href={nextStep.href} className="btn btn-primary btn-lg">{nextStep.cta}</Link>
              {first && <Link href={`/spaces/${first.id}`} className="btn btn-lg l-btn-soft">Open {first.name}</Link>}
            </div>
          </div>
        </div>

        {/* Spaces: the main thing on the page */}
        <section className="hm-section" aria-labelledby="db-spaces">
          <div className="hm-sec-head">
            <h2 id="db-spaces">Your <em className="serif">spaces</em></h2>
            <span>{spaces.length ? `${spaces.length} module${spaces.length === 1 ? "" : "s"}` : "Start with one module"}</span>
          </div>
          <ul className="sp-grid" data-tour="spaces-list">
            {spaces.map((sp, i) => {
              const st = stats[sp.id] ?? { decks: 0, cards: 0, due: 0, notes: 0 };
              return (
                <li key={sp.id} className="sp-card">
                  <Link href={`/spaces/${sp.id}`} className="stretched" aria-label={`Open ${sp.name}`} />
                  <SpaceCover spaceId={sp.id} initial={covers[sp.id] ?? COVER_COLORS[i % COVER_COLORS.length]}>
                    {st.due > 0 && <span className="sp-due">{st.due} due</span>}
                  </SpaceCover>
                  <div className="sp-body">
                    <h3 className="truncate" title={sp.name}>{sp.name}</h3>
                    <p className="truncate">{sp.subject || (sp.type === "peer" ? "Study space" : "Class hub")}</p>
                    <p className="sp-meta">{st.decks} deck{st.decks === 1 ? "" : "s"} · {st.cards} card{st.cards === 1 ? "" : "s"} · {st.notes} note{st.notes === 1 ? "" : "s"}</p>
                  </div>
                </li>
              );
            })}
            <li><NewSpaceTile first={spaces.length === 0} /></li>
          </ul>
        </section>

        {/* Everything else, one click away */}
        <details className="hm-more-box">
          <summary>Calendar, timetable and more</summary>
          <section className="hm-section hm-today-row" aria-label="Calendar and timetable">
            <CalendarWidget compact hideLms />
            <TimetableWidget />
            <SchoolSyncList />
          </section>

          {/* Below the spaces: weak spots, reading, recent papers */}
          <section className="hm-section hm-more" aria-label="More for you">

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
        </details>
      </div>
    </AppShell>
  );
}
