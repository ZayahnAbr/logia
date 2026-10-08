import type { ReactNode } from "react";
import Link from "next/link";

// Shared split layout for every auth page: coral gradient panel + white form panel.
export function AuthShell({ kicker, tagline, children }: { kicker: string; tagline: string; children: ReactNode }) {
  return (
    <main className="auth-shell">
      <div className="auth-frame">
        <aside className="auth-panel mesh-brand" aria-hidden="true">
          <Link href="/" className="auth-logo" tabIndex={-1}>
            <span className="auth-logo-mark">✳</span> logia
          </Link>
          <div>
            <p className="auth-kicker">{kicker}</p>
            <p className="auth-tagline">{tagline}</p>
          </div>
        </aside>
        <section className="auth-form">
          <span className="auth-asterisk" aria-hidden="true">✳</span>
          {children}
        </section>
      </div>
    </main>
  );
}
