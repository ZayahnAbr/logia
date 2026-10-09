import type { Metadata } from "next";
import { LogoutButton } from "@/components/logout-button";

export const metadata: Metadata = { title: "Account suspended · Logia", robots: { index: false } };

export default function SuspendedPage() {
  return (
    <main id="main" style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 16, background: "var(--bg)" }}>
      <div className="card" style={{ maxWidth: 480, width: "100%", padding: "36px 32px 40px" }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 8px" }}>This account is suspended</h1>
        <p style={{ fontSize: 15, color: "var(--muted)", lineHeight: 1.6, margin: "0 0 12px" }}>
          You can&apos;t use Logia while the suspension is in place.        </p>
        <p style={{ fontSize: 15, lineHeight: 1.6, margin: "0 0 20px" }}>
          If you think this is a mistake, write to <a href="mailto:zayahnabrahams2004@gmail.com">zayahnabrahams2004@gmail.com</a> and we will look at it.
        </p>
        <LogoutButton />
      </div>
    </main>
  );
}
