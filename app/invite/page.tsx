import Link from "next/link";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { Gift, UserPlus, Sparkles } from "lucide-react";
import { SiteNav, SiteFooter } from "@/components/site/SiteChrome";
import { getInviteInfo } from "@/app/growth-actions";
import { InviteLink } from "./InviteLink";

export const metadata: Metadata = {
  title: "Invite friends · Logia",
  description: "Invite a friend to Logia and you both get bonus AI time.",
};

const fmt = (n: number) => n.toLocaleString("en-ZA");
// Bonus credits shown as hours of full-use AI (one hour = one hourly allowance).
const hours = (tokens: number) => { const h = tokens / 20000; return h <= 0 ? "None yet" : h < 1 ? "Under an hour" : `${(Math.round(h * 2) / 2).toString()} hours`; };

export default async function InvitePage() {
  const info = await getInviteInfo();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;

  return (
    <div className="landing site" style={{ minHeight: "100dvh", background: "var(--bg)" }}>
      <SiteNav current="/invite" />
      <main id="main">
        <section className="l-wrap site-head">
          <p className="eyebrow" style={{ color: "var(--accent-text)" }}>Invite friends</p>
          <h1 className="site-h1">Bring a friend, both get more AI</h1>
          <p className="l-body">When a friend joins with your link, you each get about two and a half hours of bonus AI time, used only after your hourly allowance runs out.</p>
        </section>

        <section className="l-wrap invite-grid">
          <div className="card invite-card mesh-warm">
            {!info.signedIn ? (
              <>
                <h2>Get your invite link</h2>
                <p>Sign in or create a free account to get a personal link to share.</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Link href="/auth/sign-up" className="btn btn-primary btn-lg">Get Logia free</Link>
                  <Link href="/auth/login" className="btn btn-lg l-btn-soft">Sign in</Link>
                </div>
              </>
            ) : "error" in info && info.error ? (
              <><h2>Invites aren&apos;t ready yet</h2><p>{info.error}</p></>
            ) : (
              <>
                <h2>Your invite link</h2>
                <InviteLink url={`${origin}/?ref=${info.code}`} />
                <dl className="invite-stats">
                  <div><dt>Friends joined</dt><dd>{fmt(info.friends ?? 0)}</dd></div>
                  <div><dt>Bonus AI time left</dt><dd>{hours(info.credits ?? 0)}</dd></div>
                </dl>
              </>
            )}
          </div>

          <ol className="invite-steps" aria-label="How it works">
            <li><span className="cap-icon" aria-hidden="true"><UserPlus size={17} /></span><div><h3>Share your link</h3><p>Send it on WhatsApp, Messages or email, or post it in your class group.</p></div></li>
            <li><span className="cap-icon" aria-hidden="true"><Sparkles size={17} /></span><div><h3>Your friend signs up</h3><p>They create a free account from your link within 14 days.</p></div></li>
            <li><span className="cap-icon" aria-hidden="true"><Gift size={17} /></span><div><h3>You both get bonus AI time</h3><p>It only kicks in when your hourly allowance runs out, so it never goes to waste.</p></div></li>
          </ol>
        </section>

        <section className="l-wrap site-fine">
          <h2>The fine print</h2>
          <ul className="cap-facts">
            <li>Each account can accept one invite, within 14 days of signing up.</li>
            <li>You earn rewards for up to 25 friends.</li>
            <li>Bonus AI time doesn&apos;t expire during the beta and can&apos;t be exchanged for money.</li>
          </ul>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
