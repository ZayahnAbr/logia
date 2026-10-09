import Link from "next/link";
import { redirect } from "next/navigation";
import { User, Palette, Sparkles, LifeBuoy, LogOut, Plug, Scale, Link2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { RetakeTourButton } from "./RetakeTourButton";
import { getPlan } from "@/lib/server/plans";
import { AiAllowance } from "@/components/AiAllowance";
import "../../workspace-layout.css";
import { ProfileRow, ThemeSwitch } from "./ProfileRow";
import { LmsSection } from "./LmsSection";
import { GoogleDocsCard } from "./GoogleDocsCard";

const SECTIONS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "ai", label: "AI and plan", icon: Sparkles },
  { id: "school-sync", label: "School sync", icon: Plug },
  { id: "connections", label: "Connected apps", icon: Link2 },
  { id: "help", label: "Help", icon: LifeBuoy },
  { id: "legal", label: "Legal", icon: Scale },
  { id: "account", label: "Account", icon: LogOut },
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ classroom?: string; n?: string; msg?: string; gdocs?: string }> }) {
  const sp = await searchParams;
  const notice = sp.classroom === "ok" ? { kind: "ok" as const, text: `Google Classroom connected. Synced ${Number(sp.n) || 0} item${Number(sp.n) === 1 ? "" : "s"}.` } : sp.classroom === "error" ? { kind: "error" as const, text: (sp.msg ?? "Couldn't connect Google Classroom.").slice(0, 200) } : undefined;
  const gdocsNotice = sp.gdocs === "ok" ? { kind: "ok" as const, text: "Google Docs connected. You can now link notes from their Google Docs menu." } : sp.gdocs === "error" ? { kind: "error" as const, text: (sp.msg ?? "Couldn't connect Google Docs.").slice(0, 200) } : undefined;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");
  const plan = await getPlan(supabase, user);

  return (
    <AppShell>
      <div className="phead mesh-warm">
        <div className="eyebrow">Settings</div>
        <h1>Settings</h1>
        <div className="sub">Your profile, how Logia looks, and your AI allowance.</div>
      </div>

      <div className="st wk-settings">
        <nav className="st-nav" aria-label="Settings sections">
          {SECTIONS.map(({ id, label, icon: I }) => <a key={id} href={`#${id}`}><I size={15} aria-hidden="true" /> {label}</a>)}
        </nav>

        <div className="st-body">
          <section id="profile" className="st-sec" aria-labelledby="h-profile">
            <h2 id="h-profile">Profile</h2>
            <div className="card st-card"><ProfileRow email={user.email ?? ""} /></div>
          </section>

          <section id="appearance" className="st-sec" aria-labelledby="h-appearance">
            <h2 id="h-appearance">Appearance</h2>
            <div className="card st-card">
              <div className="st-row">
                <div><strong>Theme</strong><span>Saved on this device.</span></div>
                <ThemeSwitch />
              </div>
            </div>
          </section>

          <section id="ai" className="st-sec" aria-labelledby="h-ai">
            <h2 id="h-ai">AI and plan</h2>
            <AiAllowance />
            {plan.plan === "free" && (
              <div className="card st-card">
                <div className="st-row">
                  <div><strong>Bonus AI time</strong><span>Invite a friend and you both get extra.</span></div>
                  <Link href="/invite" className="btn">Invite friends</Link>
                </div>
                <div className="st-row">
                  <div><strong>Logia Pro</strong><span>No waiting at busy times, and big jobs are always available.</span></div>
                  <Link href="/pricing" className="btn">See Logia Pro</Link>
                </div>
              </div>
            )}
          </section>

          <section id="school-sync" className="st-sec" aria-labelledby="h-school-sync">
            <h2 id="h-school-sync">School sync (browser extension)</h2>
            <LmsSection notice={notice} />
          </section>

          <section id="connections" className="st-sec" aria-labelledby="h-connections">
            <h2 id="h-connections">Connected apps</h2>
            <GoogleDocsCard notice={gdocsNotice} />
          </section>

          <section id="help" className="st-sec" aria-labelledby="h-help">
            <h2 id="h-help">Help</h2>
            <div className="card st-card">
              <div className="st-row">
                <div><strong>Welcome tour</strong><span>Replay the tour of Logia&apos;s key features.</span></div>
                <RetakeTourButton />
              </div>
              <div className="st-row">
                <div><strong>Everything Logia can do</strong><span>Every tool, with its limits.</span></div>
                <Link href="/features" className="btn">Capabilities</Link>
              </div>
            </div>
          </section>

          <section id="legal" className="st-sec" aria-labelledby="h-legal">
            <h2 id="h-legal">Legal</h2>
            <div className="card st-card">
              <div className="st-row">
                <div><strong>Terms and policies</strong><span>Draft documents, under legal review.</span></div>
                <nav aria-label="Legal documents" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Link href="/legal/terms" className="btn">Terms</Link>
                  <Link href="/legal/acceptable-use" className="btn">Acceptable use</Link>
                  <Link href="/legal/privacy" className="btn">Privacy</Link>
                  <Link href="/legal/takedown" className="btn">Report content</Link>
                </nav>
              </div>
            </div>
          </section>

          <section id="account" className="st-sec" aria-labelledby="h-account">
            <h2 id="h-account">Account</h2>
            <div className="card st-card">
              <div className="st-row">
                <div><strong>Sign out</strong><span>Signed in as {user.email}.</span></div>
                <form action="/auth/signout" method="post"><button type="submit" className="btn st-danger"><LogOut size={14} aria-hidden="true" /> Sign out</button></form>
              </div>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
