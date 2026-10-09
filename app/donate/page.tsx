import Link from "next/link";
import type { Metadata } from "next";
import { Heart, Cpu, Server, Wrench } from "lucide-react";
import { SiteNav, SiteFooter } from "@/components/site/SiteChrome";

export const metadata: Metadata = {
  title: "Donate · Logia",
  description: "Help keep Logia free for students during the beta.",
};

// Set NEXT_PUBLIC_DONATE_URL to your payment page (e.g. a PayFast, SnapScan, Yoco or Buy Me a Coffee link).
const DONATE_URL = process.env.NEXT_PUBLIC_DONATE_URL;

export default function DonatePage() {
  return (
    <div className="landing site" style={{ minHeight: "100dvh", background: "var(--bg)" }}>
      <SiteNav current="/donate" />
      <main id="main">
        <section className="l-wrap site-head">
          <p className="eyebrow" style={{ color: "var(--accent-text)" }}>Donate</p>
          <h1 className="site-h1">Help keep Logia free</h1>
          <p className="l-body">Logia is free during the beta. Donations pay for the servers and services that keep it that way for every student.</p>
        </section>

        <section className="l-wrap invite-grid">
          <div className="card invite-card mesh-warm">
            <Heart size={22} aria-hidden="true" />
            <h2>Any amount helps</h2>
            {DONATE_URL ? (
              <>
                <p>You&apos;ll go to a secure payment page to choose an amount.</p>
                <a href={DONATE_URL} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-lg">Donate</a>
              </>
            ) : (
              <>
                <p>Online donations open soon. Until then, the best way to help is to invite a friend.</p>
                <Link href="/invite" className="btn btn-primary btn-lg">Invite friends</Link>
              </>
            )}
          </div>

          <ul className="invite-steps" aria-label="Where donations go">
            <li><span className="cap-icon" aria-hidden="true"><Cpu size={17} /></span><div><h3>Smart features</h3><p>Every flashcard, recall check and marked paper is work we pay for.</p></div></li>
            <li><span className="cap-icon" aria-hidden="true"><Server size={17} /></span><div><h3>Hosting and storage</h3><p>Your notes, textbooks and recordings are stored and backed up.</p></div></li>
            <li><span className="cap-icon" aria-hidden="true"><Wrench size={17} /></span><div><h3>New features</h3><p>Time spent building what students ask for.</p></div></li>
          </ul>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
