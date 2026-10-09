import Link from "next/link";
import { ShieldCheck, Timer, Layers, Flame, Mic } from "lucide-react";
import { Reveal, DepthStage } from "@/components/motion";
import { DemoDeck } from "@/components/landing/DemoDeck";
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
        {/* 1 · Recognition: layered hero, planes move independently */}
        <section className="l-wrap l-hero-wrap">
          <DepthStage className="l-hero mesh-warm">
            <div className="l-hero-copy" data-depth="0.12">
              <h1 className="l-hero-h">
                <span className="l-rise" style={{ ["--d" as string]: "80ms" }}>Don&apos;t just keep notes.</span>
                <span className="l-rise" style={{ ["--d" as string]: "160ms" }}><em className="serif">Learn</em> them.</span>
              </h1>
              <p className="l-rise l-hero-p" style={{ ["--d" as string]: "260ms" }}>
                Logia turns your notes into flashcards that check your recall, marks your past papers, and gives you a quiet room to study with classmates.
              </p>
              <div className="l-rise l-actions" style={{ ["--d" as string]: "340ms" }}>
                <Link href={cta.href} className="btn btn-primary btn-lg">{cta.label}</Link>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "rgba(17,17,17,.68)" }}>
                  <ShieldCheck size={15} aria-hidden="true" /> No ads. No tracking.
                </span>
              </div>
            </div>

            {/* Foreground planes: real product fragments at different depths (front planes move most) */}
            <div className="l-hero-art" aria-hidden="true">
              <div className="l-plane l-p-room" data-depth="0.5">
                <span className="l-avatars">
                  {["#f2836b", "#a9c6a2", "#9cc3e6", "#c6b8ea"].map((c, i) => <span key={c} style={{ background: c, marginLeft: i ? -7 : 0 }}>{"ZMLA"[i]}</span>)}
                </span>
                <span><span className="live-dot" /> 4 studying</span>
              </div>
              <div className="l-plane l-p-timer" data-depth="1.4">
                <Timer size={14} /> <b>38:12</b>
              </div>
              <div className="l-plane l-p-card" data-depth="1">
                <span className="l-chip-k"><Layers size={12} /> Flashcard · due today</span>
                <strong>Why does the Earth have seasons?</strong>
                <span className="l-p-btns"><span>Again</span><span>Hard</span><span className="on">Good</span></span>
              </div>
              <div className="l-plane l-p-recall" data-depth="1.8">
                <Mic size={14} /> <span><b>67%</b> recall · missed 1 point</span>
              </div>
              <div className="l-plane l-p-paper" data-depth="0.7">
                <span className="l-ring" style={{ ["--v" as string]: 74 }}><span>74%</span></span>
                <span><strong>Paper 2 · 2024</strong><small>2 topics to fix</small></span>
              </div>
              <div className="l-plane l-p-pain" data-depth="1.2">
                <Flame size={13} /> Sign errors <small>3× seen</small>
              </div>
            </div>
          </DepthStage>
        </section>

        {/* 2 · Lead: the whole product in one window */}
        <section id="tour" className="l-wrap l-sec" style={{ paddingTop: "var(--sec)" }}>
          <Reveal><ProductTour /></Reveal>
        </section>

        {/* 3 · Coolest single feature: voice-checked flashcards you can try */}
        <section id="try" className="l-wrap l-sec">
          <Reveal><DemoDeck /></Reveal>
        </section>

        {/* 4 · Belonging */}
        <section id="rooms" className="l-wrap l-sec">
          <Reveal className="l-split">
            <div>
              <p className="eyebrow" style={{ color: "var(--accent-text)" }}>Study rooms</p>
              <h2 className="l-h2">Study alongside classmates, <em className="serif">even when you’re apart</em></h2>
              <p className="l-body">Set one goal and share a timer. Keep it silent, or turn on chat and voice.</p>
              <Link href="/invite" className="btn" style={{ marginTop: 20 }}>Invite friends, get bonus AI</Link>
            </div>
            <div className="l-roomcard card">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="l-avatars l-avatars-lg">
                  {[["#f2836b", "Z"], ["#a9c6a2", "M"], ["#9cc3e6", "L"], ["#c6b8ea", "A"]].map(([c, l], i) => <span key={l} style={{ background: c, marginLeft: i ? -8 : 0 }}>{l}</span>)}
                </span>
                <span style={{ fontSize: 14, fontWeight: 600 }}><span className="live-dot" aria-hidden="true" /> 4 people studying</span>
              </div>
              <p style={{ fontSize: 13, color: "var(--muted)", margin: "6px 0 14px" }}>Zayahn · Mia · Lebo · Amara</p>
              <div className="eyebrow" style={{ color: "var(--accent-text)" }}>Session goal</div>
              <p style={{ fontSize: 15, fontWeight: 500, margin: "4px 0 14px" }}>Revise Lecture 6 and complete the practice questions.</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="room-chip">Silent co-study</span><span className="room-chip">Shared 50-minute timer</span><span className="room-chip">Chat available</span>
              </div>
            </div>
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
