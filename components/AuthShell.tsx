import type { ReactNode } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/LogoMark";

// Shared split layout for every auth page: coral gradient panel + white form panel.
export function AuthShell({ kicker, tagline, children }: { kicker: string; tagline: string; children: ReactNode }) {
  return (
    <main className="auth-shell">
      <div className="auth-frame">
        <aside className="auth-panel mesh-brand" aria-hidden="true">
          <Link href="/" className="auth-logo" tabIndex={-1}>
            <LogoMark size={28} color="#fff" /> logia
          </Link>
          <div>
            <p className="auth-kicker">{kicker}</p>
            <p className="auth-tagline">{tagline}</p>
          </div>
        </aside>
        <section className="auth-form">
          <LogoMark size={36} className="auth-asterisk" />
          {children}
        </section>
      </div>
    </main>
  );
}
