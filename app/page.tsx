import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Reveal } from "@/components/motion";
import TryLogia from "@/components/landing/TryLogia";
import { ProductTour } from "@/components/landing/ProductTour";
import { SiteNav, SiteFooter, Logo } from "@/components/site/SiteChrome";
import { createClient } from "@/lib/supabase/server";
import { RefCapture } from "@/components/site/Referral";

// Feeling curve: recognition (hero) → quiet → clarity (the peak: a note becomes recall)
// → belonging (rooms) → trust (privacy) → resolve (one line, one action).


export default async function LandingPage() {
  const { data } = await (await createClient()).auth.getUser();
  const cta = data.user ? { href: "/spaces", label: "Open Logia" } : { href: "/auth/sign-up", label: "Get Logia free" };
  return (
    <div className="landing" style={{ minHeight: "100dvh", background: "var(--bg)" }}>

      <SiteNav />
      <RefCapture />

      <main id="main">
        {/* 1 · Recognition + proof in the same breath: try the real tool before signing in */}
        <section className="l-hero-band mesh-warm">
          <div className="l-wrap l-hero3">
            <div className="l-hero3-copy">
              <h1 className="l-hero-h">
                <span className="l-rise" style={{ ["--d" as string]: "80ms" }}>Your notes,</span>
                <span className="l-rise" style={{ ["--d" as string]: "160ms" }}><em className="serif">ready</em> in seconds.</span>
              </h1>
              <p className="l-rise l-hero-p" style={{ ["--d" as string]: "260ms" }}>
                Drop a file or paste text in and see Logia turn it into notes, flashcards or a transcript right now.
              </p>
              <div className="l-rise l-actions" style={{ ["--d" as string]: "340ms" }}>
                <Link href={cta.href} className="btn btn-primary btn-lg">{cta.label}</Link>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "rgba(17,17,17,.68)" }}>
                  <ShieldCheck size={15} aria-hidden="true" /> No ads. No tracking.
                </span>
              </div>
            </div>

            <div className="l-hero3-tool l-rise" style={{ ["--d" as string]: "420ms" }}>
              <TryLogia />
            </div>
          </div>
        </section>

        {/* 2 · Lead: the whole product in one window */}
        <section id="tour" className="l-wrap l-sec" style={{ paddingTop: "var(--sec)" }}>
          <Reveal><ProductTour /></Reveal>
        </section>

        {/* 3 · Belonging */}
        <section id="rooms" className="l-wrap l-sec">
          <Reveal className="l-split">
            <div>
              <p className="eyebrow" style={{ color: "var(--accent-text)" }}>Live study rooms</p>
              <h2 className="l-h2">Need a scenic place to work? <em className="serif">Create your own live room.</em></h2>
              <p className="l-body">Pick a filmed scene, from rain on a roof to a forest stream, and work to one shared timer with everyone in it. Chat opens on the break. You can host your own room and put one on your space home.</p>
              <div className="l-actions" style={{ marginTop: 20 }}>
                <Link href="/discover?tab=rooms" className="btn btn-primary">See the rooms</Link>
                <Link href="/invite" className="btn">Invite friends, get bonus study time</Link>
              </div>
            </div>
            <div className="l-live" aria-hidden="true">
              <video className="l-live-video" src="/loops/forest-stream.mp4" poster="/loops/forest-stream.jpg" autoPlay muted loop playsInline />
              <div className="l-live-over">
                <span className="l-live-name">Forest stream <i><span className="live-dot" /> 6 studying</i></span>
                <span className="l-live-time"><small>Focus</small>18:42</span>
                <span className="l-live-next">Next: 5 min break</span>
              </div>
            </div>
          </Reveal>
        </section>

        <section className="l-wrap l-sec">
          <Reveal className="l-yours">
            <p className="eyebrow" style={{ color: "var(--accent-text)" }}>Make it yours</p>
            <h2 className="l-h2">Every module gets <em className="serif">a home of its own</em></h2>
            <ul className="l-yours-grid">
              <li><b>Set it up from your outline</b><span>Upload your course outline and Logia lays out the topics, tests and due dates. You check everything first.</span></li>
              <li><b>Arrange it your way</b><span>Choose which cards show, colour the header, and drop sticky notes, headings and cut-out stickers anywhere.</span></li>
              <li><b>Share what helps</b><span>Show your notebooks and decks to classmates, or make the space public on Discover for others to copy.</span></li>
            </ul>
            <Link href="/features" className="btn" style={{ marginTop: 8 }}>See everything Logia can do</Link>
          </Reveal>
        </section>

        {/* 5 · Trust → 6 · Resolve: one centred line, one action */}
        <section className="l-wrap l-sec">
          <Reveal className="l-close">
            <Logo size={44} />
            <h2 className="l-h2">Start with the notes <em className="serif">you already have</em>.</h2>
            <p className="l-body">Free for students. Upload a lecture or paste a page of notes, and your first deck is ready in a minute.</p>
            <div className="l-actions" style={{ justifyContent: "center" }}>
              <Link href={cta.href} className="btn btn-primary btn-lg">{cta.label}</Link>
              <Link href="#tour" className="btn btn-lg l-btn-soft">See how it works</Link>
            </div>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
