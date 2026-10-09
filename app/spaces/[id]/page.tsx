import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { InviteButton } from "@/components/InviteButton";
import { MakePublicButton } from "@/components/MakePublicButton";
import { createClient } from "@/lib/supabase/server";
import { getSpace, getSpaceStudyData, getNotes, getPastPapers, getPainPoints, getLibraryBooks, getFiles } from "@/lib/queries";
import { CourseOutlineButton } from "@/components/CourseOutlineSetup";
import { HomeMarks, HomeTopics } from "@/components/CourseTracker";
import { loadCourses } from "@/lib/server/courses";
import { BookCover } from "@/components/BookCover";
import { MusicWidget } from "@/components/MusicWidget";
import { StickyNotes } from "@/components/StickyNotes";
import { CalendarWidget } from "@/components/CalendarWidget";
import { TimetableWidget } from "@/components/TimetableWidget";
import { SpaceHeaderEditor } from "./_components/SpaceHeaderEditor";
import { HEADER_BUCKET, headerLook, type HeaderKind } from "@/lib/spaceHeader";
import "../../workspace-layout.css";
import { SpaceDashboard } from "./_components/SpaceDashboard";
import { DashboardGrid, type Widget } from "../_components/DashboardGrid";
import { AddWidgetButton } from "./_components/CustomWidgets";
import { SharedItemsWidget } from "./_components/SharedItemsWidget";
import { ViewLinkButton } from "@/components/ViewLinkButton";
import { CloneSpaceButton } from "@/components/CloneSpaceButton";
import { loadSharedItems, saveDesignLayout } from "@/app/shared-items-actions";
import { StickerLayer, type Sticker } from "./_components/StickerLayer";
import { WIDGET_BUCKET, type ImageData, type TextData, type StickyData } from "@/lib/customWidgets";
import { FileText, Files, Mic, Workflow, MessageSquare, FileCheck2, Flame, Sigma, ScanLine, Users, type LucideIcon } from "lucide-react";

const TOOLS: { title: string; icon: LucideIcon; slug: string }[] = [
  { title: "Notes", icon: FileText, slug: "notes" },
  { title: "Papers", icon: FileCheck2, slug: "papers" },
  { title: "Files", icon: Files, slug: "files" },
  { title: "Lectures", icon: Mic, slug: "lectures" },
  { title: "Mind maps", icon: Workflow, slug: "maps" },
  { title: "Solver", icon: Sigma, slug: "solver" },
  { title: "Scan", icon: ScanLine, slug: "scan" },
  { title: "Chat", icon: MessageSquare, slug: "chat" },
  { title: "Study rooms", icon: Users, slug: "rooms" },
];

export default async function SpacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");

  const [space, study, notes, papers, pains, books] = await Promise.all([
    getSpace(id), getSpaceStudyData(id), getNotes(id), getPastPapers(id), getPainPoints(id), getLibraryBooks(),
  ]);
  if (!space) notFound();
  const { decks, due, perDeck } = study;

  // Custom widgets and colours (migration 25). Missing tables just mean none yet.
  const [{ data: cwRows }, { data: colorRow }, { data: stickyFlag }, { data: viewFlag }] = await Promise.all([
    supabase.from("space_widgets").select("id, kind, data").eq("user_id", user.id).eq("space_id", id).order("created_at"),
    supabase.from("space_widget_colors").select("colors").eq("user_id", user.id).eq("space_id", id).maybeSingle(),
    // Set by migration 28. If it has not been run, the old sticky-notes widget stays.
    supabase.from("migrations_applied").select("name").eq("name", "migration-28-sticky-stickers").maybeSingle(),
    // Set by migration 40. Until then the Share view link button stays hidden.
    supabase.from("migrations_applied").select("name").eq("name", "migration-40-view-links").maybeSingle(),
  ]);
  const viewLinksReady = !!viewFlag;
  const stickyReady = !!stickyFlag;
  // Copy options and the saved design layout (migration 39).
  const cloneFlags = space as unknown as { allow_design_clone?: boolean; allow_content_clone?: boolean; design_layout?: { id: string; visible: boolean; half?: boolean }[] | null };
  const cloneReady = "allow_design_clone" in cloneFlags;
  // Shared notebooks and decks (migration 39). null = not run, so the widget is hidden.
  const sharedItems = await loadSharedItems(id);
  // Course outline data (migration 30). Missing tables just mean nothing set up yet.
  const [{ courses }, outlineFiles] = await Promise.all([loadCourses(supabase, user.id, id), getFiles(id)]);
  const withAss = courses.filter((c) => c.assessments.length > 0);
  const withTopics = courses.filter((c) => c.topics.length > 0);
  const hasCourse = courses.length > 0;
  const colors = (colorRow?.colors as Record<string, string> | null) ?? {};
  // Images and text are free stickers (StickerLayer), not grid widgets. Old GIF rows are dropped from the UI.
  const stickers: Sticker[] = (await Promise.all((cwRows ?? []).map(async (r): Promise<Sticker | null> => {
    if (r.kind === "text") return { id: r.id, kind: "text", data: r.data as TextData, src: null };
    if (r.kind === "sticky") return stickyReady ? { id: r.id, kind: "sticky", data: r.data as StickyData, src: null } : null;
    if (r.kind !== "image") return null;
    const d = r.data as ImageData;
    let src: string | null = d.source === "link" ? d.url ?? null : null;
    if (d.source === "upload" && d.path) {
      const { data: signed } = await supabase.storage.from(WIDGET_BUCKET).createSignedUrl(d.path, 6 * 3600);
      src = signed?.signedUrl ?? null;
    }
    return { id: r.id, kind: "image", data: d, src };
  }))).filter((s): s is Sticker => s !== null);
  const openPains = pains.filter((p) => !p.resolved).slice(0, 4);
  // The card the student will actually see next (due first, else the first card they own).
  const firstDeck = decks.find((d) => (d.cards_json as unknown[])?.length);
  const sample = due[0]
    ? { q: due[0].question, tag: due[0].concept || due[0].deckTitle, deckId: due[0].deckId }
    : firstDeck ? { q: (firstDeck.cards_json as { question: string; concept?: string }[])[0].question, tag: (firstDeck.cards_json as { concept?: string }[])[0].concept || firstDeck.title, deckId: firstDeck.deck_id } : null;
  const totalCards = decks.reduce((s, d) => s + ((d.cards_json as unknown[])?.length ?? 0), 0);

  const empty = (text: string, href?: string, cta?: string) => (
    <div className="empty card" style={{ padding: "24px 20px" }}>
      {text}
      {href && <div style={{ marginTop: 12 }}><Link href={href} className="btn btn-sm">{cta}</Link></div>}
    </div>
  );
  const row = { display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", minWidth: 0 } as const;

  const allWidgets: Widget[] = [
    {
      id: "library", title: "Library", description: "Your textbooks, with covers and reading progress", empty: books.length === 0,
      node: books.length === 0 ? empty("Add a textbook PDF to your Library to read, highlight and bookmark it.", "/library", "Open Library") : (
        <div className="shelf-row">
          {books.slice(0, 6).map((b) => {
            const pct = b.page_count ? Math.round((b.last_page / b.page_count) * 100) : 0;
            return (
              <Link key={b.id} href={`/library/${b.id}`} className="shelf-mini" title={b.title}>
                <BookCover title={b.title} url={b.cover_url} width={132} />
                <span className="truncate" style={{ fontSize: 12.5, fontWeight: 600 }}>{b.title}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{b.opened_at ? `${pct}% read` : "New"}</span>
              </Link>
            );
          })}
        </div>
      ),
    },
    {
      id: "outline", title: "Course outline", description: "Build this space from your course outline or handbook", empty: hasCourse,
      node: <CourseOutlineButton spaceId={id} files={(outlineFiles ?? []).map((f: { id: string; name: string; path: string; mime_type: string }) => ({ id: f.id, name: f.name, path: f.path, mime_type: f.mime_type }))} />,
    },
    {
      id: "marks", title: "Mark calculator", description: "Your marks, weighted total and what you need on the rest", empty: withAss.length === 0,
      node: withAss.length === 0 ? empty("Set this space up from your course outline to track your marks here.") : <HomeMarks courses={withAss} />,
    },
    {
      id: "checklist", title: "Topic checklist", description: "Tick off each topic as you finish it", empty: withTopics.length === 0,
      node: withTopics.length === 0 ? empty("Set this space up from your course outline to get a topic checklist.") : <HomeTopics courses={withTopics} />,
    },
    {
      id: "calendar", title: "Calendar", description: "Tests, assignments and tasks for this space, with urgency and colour",
      node: <CalendarWidget spaceId={id} />,
    },
    {
      id: "timetable", title: "Timetable", description: "Your weekly lectures, labs and venues, read from a photo of your timetable",
      node: <TimetableWidget spaceId={id} />,
    },
    {
      id: "stickies", title: "Sticky notes", description: "Quick jottings for this space, saved as you type",
      node: <StickyNotes spaceId={id} />,
    },
    {
      id: "music", title: "Study music", description: "Play a Spotify, YouTube, Apple Music or SoundCloud playlist",
      node: <MusicWidget />,
    },
    {
      id: "decks", title: "Flashcard decks", description: "Your decks and what's due for review",
      node: (
        <SpaceDashboard spaceId={space.id} due={due.length}
          decks={decks.map((d) => ({ deckId: d.deck_id, title: d.title, subject: d.subject, preview: ((d.cards_json as { question?: string }[] | null)?.[0]?.question) ?? null, ...perDeck[d.deck_id] }))} />
      ),
    },
    ...(sharedItems ? [{
      id: "shared", title: "Shared notebooks and flashcards", description: "Notebooks and decks members chose to show here, which you can preview and copy",
      node: <SharedItemsWidget spaceId={id} items={sharedItems} />,
    } satisfies Widget] : []),
    {
      id: "stats", title: "At a glance", description: "Decks, cards, notes and what is due", empty: decks.length === 0 && notes.length === 0,
      node: (
        <div className="wk-stat-strip">
          {[
            { label: "Decks", value: decks.length },
            { label: "Cards", value: totalCards },
            { label: "Due for review", value: due.length },
            { label: "Notes", value: notes.length },
            { label: "Marked papers", value: papers.length },
            { label: "Open weak spots", value: pains.filter((p) => !p.resolved).length },
          ].map((s) => (
            <div key={s.label} className="card" style={{ padding: "16px 18px" }}>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.02em" }}>{s.value}</div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>{s.label}</div>
            </div>
          ))}
        </div>
      ),
    },
    {
      id: "tools", title: "Study tools", description: "Everything this space can do",
      node: (
        <div className="ft">
          <Link href={sample ? `/spaces/${id}/decks/${sample.deckId}` : `/spaces/${id}/decks`} className="ft-tile ft-cards">
            <span className="ft-art" aria-hidden="true">
              <i /><i />
              <i className="ft-card-top">
                {sample ? (
                  <>
                    <span className="ft-card-tag">{due.length ? "Due now" : "Next up"} · {sample.tag}</span>
                    <span className="ft-card-q">{sample.q}</span>
                    <span className="ft-card-mic"><Mic size={11} /> Hold to answer <b className="pt-wave"><em /><em /><em /><em /></b></span>
                  </>
                ) : (
                  <>
                    <span className="ft-card-tag">Your first card</span>
                    <span className="ft-card-q">Make a deck from any note in one click.</span>
                  </>
                )}
              </i>
            </span>
            <span className="ft-copy"><strong>Flashcards</strong><span>{due.length ? `${due.length} due. Answer out loud and see what you missed.` : "Answer out loud and see what you missed."}</span></span>
          </Link>
          <Link href={`/spaces/${id}/rooms`} className="ft-tile ft-rooms">
            <span className="ft-art" aria-hidden="true">
              <span className="ft-ppl">{["#f2836b", "#a9c6a2", "#9cc3e6", "#c6b8ea"].map((c) => <i key={c} style={{ background: c }} />)}</span>
              <span className="ft-live"><span className="live-dot" /> live</span>
            </span>
            <span className="ft-copy"><strong>Study rooms</strong><span>Shared goal, shared timer, chat and voice.</span></span>
          </Link>
          <Link href={`/spaces/${id}/papers`} className="ft-tile ft-papers">
            <span className="ft-art" aria-hidden="true"><span className="l-ring" style={{ ["--v" as string]: 74 }}><span>74%</span></span><span className="ft-ticks"><i className="ok" /><i className="ok" /><i /><i className="ok" /></span></span>
            <span className="ft-copy"><strong>Past papers</strong><span>Upload a marked paper, see where the marks went.</span></span>
          </Link>
          <Link href={`/spaces/${id}/maps`} className="ft-tile ft-maps">
            <span className="ft-art" aria-hidden="true"><i className="root" /><i /><i /><i /><svg viewBox="0 0 100 60" preserveAspectRatio="none"><path d="M50 30 L18 12 M50 30 L82 12 M50 30 L50 54" /></svg></span>
            <span className="ft-copy"><strong>Mind maps</strong><span>Turn a chapter into a map you can edit.</span></span>
          </Link>
          <Link href={`/spaces/${id}/chat`} className="ft-tile ft-ai">
            <span className="ft-art" aria-hidden="true"><i className="q" /><i className="a" /><i className="a short" /></span>
            <span className="ft-copy"><strong>Ask AI</strong><span>Answers from your notes, with sources.</span></span>
          </Link>
          <Link href={`/spaces/${id}/lectures`} className="ft-tile ft-lect">
            <span className="ft-art" aria-hidden="true"><span className="ft-rec" /><span className="ft-bars">{[6, 12, 18, 10, 16, 8, 14, 20, 9, 13].map((h, k) => <i key={k} style={{ height: h }} />)}</span></span>
            <span className="ft-copy"><strong>Lectures</strong><span>Record or upload, get a transcript and cards.</span></span>
          </Link>
          <nav aria-label="More tools" className="ft-more">
            {TOOLS.filter((t) => ["notes", "files", "scan", "solver"].includes(t.slug)).map((t) => (
              <Link key={t.slug} href={`/spaces/${id}/${t.slug}`}><t.icon size={15} aria-hidden="true" /> {t.title}</Link>
            ))}
            <Link href={`/spaces/${id}/formulas`}><Sigma size={15} aria-hidden="true" /> Formula sheet</Link>
            <Link href={`/spaces/${id}/pain-points`}><Flame size={15} aria-hidden="true" /> Pain points</Link>
          </nav>
        </div>
      ),
    },
    {
      id: "notes", title: "Recent notes", description: "The notes you edited most recently", empty: notes.length === 0,
      node: notes.length === 0 ? empty("Write what you learnt, then turn it into flashcards in one click.", `/spaces/${id}/notes`, "Write a note") : (
        <div className="card" style={{ padding: 6 }}>
          {notes.slice(0, 4).map((n) => (
            <Link key={n.id} href={`/spaces/${id}/notes`} className="dash-row" style={row}>
              <FileText size={16} aria-hidden="true" style={{ color: "var(--accent-text)", flexShrink: 0 }} />
              <span className="truncate" style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{n.title || "Untitled note"}</span>
              <span style={{ fontSize: 12.5, color: "var(--muted)", flexShrink: 0 }}>{new Date(n.updated_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
            </Link>
          ))}
        </div>
      ),
    },
    {
      id: "papers", title: "Marked papers", description: "Your latest past papers in this space", empty: papers.length === 0,
      node: papers.length === 0 ? empty("Upload a marked past paper to see exactly where you lost marks.", `/spaces/${id}/papers`, "Upload a paper") : (
        <div className="card" style={{ padding: 6 }}>
          {papers.slice(0, 4).map((p) => (
            <Link key={p.id} href={`/spaces/${id}/papers/${p.id}`} className="dash-row" style={row}>
              <FileCheck2 size={16} aria-hidden="true" style={{ color: "var(--accent-text)", flexShrink: 0 }} />
              <span className="truncate" title={p.title} style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{p.title}</span>
            </Link>
          ))}
        </div>
      ),
    },
    {
      id: "pain", title: "Pain points", description: "Mistakes you keep making in this space", empty: openPains.length === 0,
      node: openPains.length === 0 ? empty("Topics you get wrong in papers and quizzes collect here so you can target them.", `/spaces/${id}/papers`, "Mark a paper") : (
        <div className="card" style={{ padding: 6 }}>
          {openPains.map((p) => (
            <Link key={p.id} href={`/spaces/${id}/pain-points`} className="dash-row" style={row}>
              <Flame size={16} aria-hidden="true" style={{ color: p.hits >= 3 ? "var(--danger)" : "var(--warning)", flexShrink: 0 }} />
              <span className="truncate" style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{p.title}</span>
              <span style={{ fontSize: 12.5, color: "var(--muted)", flexShrink: 0 }}>{p.hits}× seen</span>
            </Link>
          ))}
        </div>
      ),
    },
  ];
  // Sticky notes are free stickers once migration 28 has run; until then the old grid widget stays.
  const widgets = stickyReady ? allWidgets.filter((w) => w.id !== "stickies") : allWidgets;
  const noStickies = (ids: string[]) => (stickyReady ? ids.filter((x) => x !== "stickies") : ids);

  // Custom header (migration 38). Without the columns the header stays the default and the button is hidden.
  const sp = space as unknown as { header_kind?: HeaderKind | null; header_color?: string | null; header_image_path?: string | null };
  const headerReady = "header_kind" in sp;
  const headerKind: HeaderKind = sp.header_kind ?? "default";
  const headerColor = sp.header_color ?? null;
  let headerUrl: string | null = null;
  if (headerReady && headerKind === "image" && sp.header_image_path) {
    const { data: signed } = await supabase.storage.from(HEADER_BUCKET).createSignedUrl(sp.header_image_path, 6 * 3600);
    headerUrl = signed?.signedUrl ?? null;
  }
  const look = headerLook(headerReady ? headerKind : "default", headerColor, headerUrl);
  // Study spaces: any member. Class hubs: only the creator (same rule as set_space_header).
  const canEditHeader = space.type === "teacher_hub" ? space.created_by === user.id : true;
  const heroTexts = {
    eyebrow: `${space.type === "peer" ? "Study space" : "Class hub"}${space.subject ? ` · ${space.subject}` : ""}`,
    sub: `${due.length ? `${due.length} card${due.length === 1 ? "" : "s"} due today` : "You're up to date"}${openPains.length ? ` · ${openPains.length} weak spot${openPains.length === 1 ? "" : "s"} to fix` : ""}`,
  };

  return (
    <div className="wk-home">
      <header className={`space-hero ${look.mesh ? "mesh-warm" : look.className}`} style={look.style} data-sh-header="">
        <div>
        <p className="eyebrow" style={{ color: "rgba(17,17,17,.66)", margin: 0 }}>{heroTexts.eyebrow}</p>
        <h1 className="space-hero-h">{space.name}</h1>
        <p className="space-hero-p">{heroTexts.sub}</p>
        {space.copied_from_name && <p className="shr-credit">Copied from {space.copied_from_name}</p>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {headerReady && canEditHeader && <SpaceHeaderEditor spaceId={id} kind={headerKind} color={headerColor} imageUrl={headerUrl} texts={{ ...heroTexts, name: space.name }} />}
          {space.created_by === user.id && <MakePublicButton spaceId={id} isPublic={!!space.is_public} description={space.public_description ?? ""} cloneReady={cloneReady} allowDesign={cloneFlags.allow_design_clone ?? true} allowContent={cloneFlags.allow_content_clone ?? false} />}
          {viewLinksReady && (space.created_by === user.id || canEditHeader) && <ViewLinkButton spaceId={id} />}
          {space.is_public && space.created_by !== user.id && <CloneSpaceButton spaceId={id} spaceName={space.name} className="btn btn-sm" />}
          {space.invite_code && <InviteButton code={space.invite_code} />}
        </div>
      </header>
      <StickerLayer spaceId={id} stickers={stickers} colors={colors}>
        <DashboardGrid
          widgets={widgets}
          storageKey={`logia.space.${id}.layout`}
          defaultOrder={noStickies(["outline", "stats", "marks", "checklist", "tools", "calendar", "notes", "pain", "decks", "shared", "papers", "stickies", "library", "music"])}
          defaultVisible={noStickies(["outline", "stats", "marks", "checklist", "tools", "calendar", "notes", "pain", "decks", "shared", "papers", "stickies", "library"])}
          defaultHalf={noStickies(["marks", "checklist", "calendar", "notes", "pain", "papers", "stickies", "music"])}
          syncToAccount={false}
          toolbarExtra={<AddWidgetButton key="add-widget" spaceId={id} stickyReady={stickyReady} />}
          colorSpaceId={id}
          seed={space.copied_from_name ? cloneFlags.design_layout ?? null : null}
          onLayoutSaved={space.created_by === user.id && space.is_public && cloneReady ? saveDesignLayout.bind(null, id) : undefined}
          colors={colors}
          dialogTitle="Customise space home"
        />
      </StickerLayer>
    </div>
  );
}
