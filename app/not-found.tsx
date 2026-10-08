import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 16, background: "var(--bg)" }}>
      <div className="card" style={{ maxWidth: 440, width: "100%", padding: "36px 32px 40px" }}>
        <p className="eyebrow" style={{ color: "var(--accent-text)", margin: 0 }}>404</p>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: "8px 0 8px" }}>This page doesn&apos;t exist</h1>
        <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.6, margin: "0 0 20px" }}>
          The link may be old, or the space it belonged to was deleted or you no longer have access.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/spaces" className="btn btn-primary">Go to dashboard</Link>
          <Link href="/library" className="btn btn-ghost">Open library</Link>
        </div>
      </div>
    </main>
  );
}
