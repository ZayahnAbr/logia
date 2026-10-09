import Link from "next/link";
import type { Metadata } from "next";
import { Check } from "lucide-react";
import { SiteNav, SiteFooter } from "@/components/site/SiteChrome";
import { WaitlistForm } from "@/components/site/WaitlistForm";

export const metadata: Metadata = {
  title: "Pricing · Logia",
  description: "Logia is free during the beta. Join the waitlist to lock in the R99 early-member price for Logia Pro.",
};

const FREE = ["Every tool, in every space", "Fair-use limits that refill every hour", "Bonus study time for each friend you invite", "Study rooms with chat and voice"];
const EARLY = ["Everything in the beta", "No waiting at busy times", "Big jobs like marking papers and reading course outlines are always available", "Priority when the app is busy", "The R99 early-member price, kept for as long as you stay subscribed", "First access to new features"];

export default function PricingPage() {
  return (
    <div className="landing site" style={{ minHeight: "100dvh", background: "var(--bg)" }}>
      <SiteNav current="/pricing" />
      <main id="main">
        <section className="l-wrap site-head">
          <p className="eyebrow" style={{ color: "var(--accent-text)" }}>Pricing</p>
          <h1 className="site-h1">Free while Logia is in beta</h1>
          <p className="l-body">Use everything at no cost. Smart features have a fair-use limit that refills every hour. Want no waiting? Join the waitlist for Logia Pro.</p>
        </section>

        <section className="l-wrap price-grid" aria-label="Plans">
          <article className="card price-card">
            <h2>Beta</h2>
            <p className="price"><b>R0</b> <span>during the beta</span></p>
            <ul className="price-list">{FREE.map((f) => <li key={f}><Check size={15} aria-hidden="true" /> {f}</li>)}</ul>
            <Link href="/auth/sign-up" className="btn btn-lg" style={{ marginTop: "auto" }}>Get Logia free</Link>
          </article>

          <article className="card price-card price-featured" aria-labelledby="early-h">
            <span className="price-flag">Early-member perk</span>
            <h2 id="early-h">Logia Pro</h2>
            <p className="price"><b>R99</b> <span>early-member price</span></p>
            <ul className="price-list">{EARLY.map((f) => <li key={f}><Check size={15} aria-hidden="true" /> {f}</li>)}</ul>
            <div style={{ marginTop: "auto" }}>
              <p className="price-note">Paid plans aren&apos;t open yet. Joining the waitlist is free and doesn&apos;t commit you to anything.</p>
              <WaitlistForm />
            </div>
          </article>
        </section>

        <section className="l-wrap price-faq" aria-labelledby="faq-h">
          <h2 id="faq-h" className="l-h2" style={{ fontSize: "clamp(1.4rem, 2.6vw, 1.9rem)" }}>Questions</h2>
          <dl>
            <div><dt>How much can I do for free?</dt><dd>Enough for a focused hour of study: checking a few dozen spoken answers, generating a couple of decks, or marking a past paper. Logia shows how much of this hour&apos;s allowance you&apos;ve used, and it refills on a rolling hourly basis. With Logia Pro you don&apos;t wait at busy times.</dd></div>
            <div><dt>What happens when I reach the limit?</dt><dd>Smart features pause and Logia tells you when they&apos;ll be back. Everything else, like notes, reading and reviewing cards, keeps working. If you have bonus study time from invites, they keep going and use that instead.</dd></div>
            <div><dt>Why is there a limit at all?</dt><dd>Smart features cost money to run. A fair-use limit keeps Logia free for everyone during the beta. Logia Pro is for students who lean on it every day.</dd></div>
            <div><dt>Will I lose my work if I don&apos;t upgrade?</dt><dd>No. The beta plan stays, and your notes, decks and papers are yours either way.</dd></div>
          </dl>
          <p className="l-body">Want more now? <Link href="/invite" className="site-link">Invite a friend</Link> and you both get bonus study time.</p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
