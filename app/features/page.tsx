import Link from "next/link";
import type { Metadata } from "next";
import {
  FileText, ScanLine, Mic, Files, BookOpen, MessageSquare, Workflow, SquareRadical, Sigma,
  Layers, ListChecks, FileCheck2, Flame, Users, Share2, BarChart3, Timer, ShieldCheck, ClipboardList, Clapperboard, Compass, Palette, StickyNote, CalendarDays, GraduationCap, type LucideIcon,
} from "lucide-react";
import { SiteNav, SiteFooter } from "@/components/site/SiteChrome";

export const metadata: Metadata = {
  title: "Capabilities · Logia",
  description: "Every Logia tool, what it does, and its limits during the beta.",
};

// The landing page sells the idea; this page is the reference: every tool, what goes in,
// what comes out, and the real limits. Grouped by the order a student actually works in.
type Tool = { icon: LucideIcon; name: string; does: string; facts: string[] };
const STAGES: { id: string; title: string; intro: string; tools: Tool[] }[] = [
  {
    id: "capture", title: "Capture", intro: "Get the material in, however it arrives.",
    tools: [
      { icon: FileText, name: "Notes", does: "A rich editor for typed notes, with images and embedded videos.", facts: ["Notebooks with covers", "Turn any note, or one highlighted passage, into flashcards", "Export to Markdown or PDF"] },
      { icon: ScanLine, name: "Scan", does: "Photograph handwritten or printed pages and get editable text.", facts: ["Several pages in one go, read in order", "Works with your phone camera"] },
      { icon: Mic, name: "Lectures", does: "Upload a recording to get a transcript, a summary and a deck.", facts: ["Audio is compressed on your device before upload", "Up to 25 MB after compression"] },
      { icon: Files, name: "Files", does: "Keep slides, readings and handouts with the module they belong to.", facts: ["Any file type, up to 25 MB", "PDF and text files become searchable by Ask Logia"] },
      { icon: ClipboardList, name: "Course outline", does: "Upload your outline or handbook and Logia sets up the space for you.", facts: ["Finds topics, tests, due dates and textbooks", "You check every item before anything is saved"] },
      { icon: BookOpen, name: "Library", does: "Read your textbooks and ebooks in the app, with highlights and bookmarks.", facts: ["PDFs and EPUBs up to 100 MB", "Covers on your shelf, and it remembers your place", "Four highlight colours, each with a note"] },
    ],
  },
  {
    id: "understand", title: "Understand", intro: "Make sense of it before you try to memorise it.",
    tools: [
      { icon: MessageSquare, name: "Ask Logia", does: "Ask questions about everything in a space.", facts: ["Answers come from your own material, not the internet", "Every answer names its source"] },
      { icon: Workflow, name: "Mind maps", does: "Turn a PDF chapter into a map of its topics, then edit it.", facts: ["Add, move and colour any topic", "Send a branch to a note in one click"] },
      { icon: SquareRadical, name: "Formula sheet", does: "Collect the equations for a module in one printable sheet.", facts: ["Symbol keypad, so no LaTeX needed", "Group by topic"] },
      { icon: Sigma, name: "Solver", does: "Step-by-step working for algebra and calculus.", facts: ["Simplify, factor, differentiate, integrate and find zeroes", "Type plain maths, like x^2 + 3x"] },
    ],
  },
  {
    id: "practise", title: "Practise", intro: "Test yourself until it sticks.",
    tools: [
      { icon: Layers, name: "Flashcards", does: "Cards scheduled to return just before you'd forget them.", facts: ["Answer by speaking, typing or handwriting", "Recall check: what you got, what you missed", "FSRS scheduling, the algorithm used by modern spaced-repetition apps"] },
      { icon: ListChecks, name: "Quizzes", does: "Multiple-choice quizzes built from any deck.", facts: ["Plausible wrong answers, not obvious ones", "Answers shuffle every time"] },
      { icon: FileCheck2, name: "Past papers", does: "Upload a paper you've written and its memo, and get it marked.", facts: ["PDFs or phone photos", "Feedback on every question", "Generate five new questions on what you got wrong"] },
      { icon: Flame, name: "Pain points", does: "One list of the mistakes you keep making.", facts: ["Added automatically from marked papers, or by you", "Counts how often each one comes back"] },
    ],
  },
  {
    id: "together", title: "Together", intro: "Study with people, not just near them.",
    tools: [
      { icon: Users, name: "Live study rooms", does: "Focus alongside other students in a calm filmed scene with one shared timer.", facts: ["Eight rooms, from rain on a roof to a forest stream", "Chat opens only on the break", "No webcams, ever"] },
      { icon: Clapperboard, name: "Host your own room", does: "Pick a scene or upload your own loop, add music and a cover, set the timer and invite people.", facts: ["Works by link straight away", "Listed on Discover after a quick safety review"] },
      { icon: Compass, name: "Discover", does: "Browse public spaces from other students and copy the ones you like.", facts: ["Filter by tag, level and university", "Copy the design, the content or both"] },
      { icon: Share2, name: "Spaces and sharing", does: "Invite classmates with a code, share notebooks and decks, or send a read-only view link.", facts: ["Shared notebooks and decks show the owner's description", "Uploaded files stay private"] },
    ],
  },
  {
    id: "yours", title: "Make it yours", intro: "Each module gets a home that looks and works the way you like.",
    tools: [
      { icon: Palette, name: "Space home", does: "Choose which cards show, reorder them and pick a colour for the header.", facts: ["Hide what you don't use", "Your layout is saved"] },
      { icon: StickyNote, name: "Stickers and notes", does: "Drop sticky notes, headings, pictures and cut-out stickers anywhere, then drag and resize them.", facts: ["Cut a person or object out of a photo", "Put a live room on your space home"] },
      { icon: Timer, name: "Focus timer", does: "Timed study blocks, logged automatically.", facts: ["Counts towards your weekly focus hours"] },
    ],
  },
  {
    id: "track", title: "Track", intro: "Know where you stand.",
    tools: [
      { icon: BarChart3, name: "Progress", does: "Mastery, streaks and accuracy for each space.", facts: ["Weekly summary on your dashboard"] },
      { icon: CalendarDays, name: "Timetable and deadlines", does: "Your lectures and due dates in one week view.", facts: ["Photograph a printed timetable to add it", "School sites sync deadlines with the browser extension"] },
      { icon: GraduationCap, name: "Course and marks", does: "Track every assessment and see what you need on the rest.", facts: ["Built from your course outline"] },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <div className="landing site" style={{ minHeight: "100dvh", background: "var(--bg)" }}>
      <SiteNav current="/features" />
      <main id="main">
        <section className="l-wrap site-head">
          <p className="eyebrow" style={{ color: "var(--accent-text)" }}>Capabilities</p>
          <h1 className="site-h1">Everything Logia can do</h1>
          <p className="l-body">Every tool, what it does with your material, and the limits that apply during the beta.</p>
          <nav aria-label="Jump to" className="site-jump">
            {STAGES.map((s) => <a key={s.id} href={`#${s.id}`}>{s.title}</a>)}
          </nav>
        </section>

        {STAGES.map((stage) => (
          <section key={stage.id} id={stage.id} className="l-wrap cap-stage" aria-labelledby={`${stage.id}-h`}>
            <div className="cap-stage-head">
              <h2 id={`${stage.id}-h`} className="l-h2">{stage.title}</h2>
              <p>{stage.intro}</p>
            </div>
            <ul className="cap-grid">
              {stage.tools.map(({ icon: I, name, does, facts }) => (
                <li key={name} className="card cap-card">
                  <span className="cap-icon" aria-hidden="true"><I size={17} /></span>
                  <h3>{name}</h3>
                  <p>{does}</p>
                  <ul className="cap-facts">{facts.map((f) => <li key={f}>{f}</li>)}</ul>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section className="l-wrap cap-stage">
          <div className="cap-split">
            <div className="card cap-panel">
              <ShieldCheck size={20} aria-hidden="true" style={{ color: "var(--accent-text)" }} />
              <h2>Privacy</h2>
              <ul className="cap-facts">
                <li>Your work is stored behind row-level security, so other accounts can&apos;t read it</li>
                <li>Only the text you ask about is used to write your answer, and it isn&apos;t used to train models</li>
                <li>No ads and no tracking</li>
              </ul>
            </div>
            <div className="card cap-panel">
              <h2>What Logia won&apos;t do</h2>
              <ul className="cap-facts">
                <li>Write your essays or assignments for you</li>
                <li>Answer from the internet when your notes don&apos;t cover it. It tells you instead</li>
                <li>Sell or share your notes</li>
              </ul>
            </div>
          </div>
          <div className="cap-beta card">
            <div>
              <h2>Beta limits</h2>
              <p>Smart features have a fair-use limit that refills every hour, enough for a focused study session. Inviting friends earns bonus study time.</p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link href="/pricing" className="btn btn-primary">See pricing</Link>
              <Link href="/invite" className="btn">Invite friends</Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
