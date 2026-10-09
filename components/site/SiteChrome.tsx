import Link from "next/link";
import { LogoMark } from "@/components/LogoMark";

// Public-site chrome shared by the landing page and the marketing pages.
export const Logo = ({ size = 28 }: { size?: number }) => <LogoMark size={size} />;

const LINKS = [
  { href: "/features", label: "Capabilities" },
  { href: "/pricing", label: "Pricing" },
  { href: "/invite", label: "Invite friends" },
  { href: "/donate", label: "Donate" },
];

const LEGAL_LINKS = [
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/acceptable-use", label: "Acceptable use" },
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/takedown", label: "Report content" },
];

export function SiteNav({ current }: { current?: string }) {
  return (
    <header className="l-nav-dark">
      <div className="l-wrap l-nav-row">
        <Link href="/" className="l-nav-brand" aria-label="Logia home"><Logo size={26} /> logia</Link>
        <nav aria-label="Main" className="l-nav-links">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={current === l.href ? "page" : undefined} className={current === l.href ? "on" : ""}>{l.label}</Link>
          ))}
        </nav>
        <div className="l-nav-cta">
          <Link href="/auth/login" className="l-nav-signin">Sign in</Link>
          <Link href="/auth/sign-up" className="btn btn-sm l-nav-get">Get Logia free</Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="l-footer">
      <div className="l-wrap l-footer-row">
        <span className="l-footer-logo"><Logo size={22} /> logia</span>
        <nav aria-label="Footer" className="l-footer-links">
          {LINKS.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
        </nav>
        <nav aria-label="Legal" className="l-footer-links">
          {LEGAL_LINKS.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
        </nav>
        <span>© 2026 Logia · Made in South Africa</span>
      </div>
    </footer>
  );
}
