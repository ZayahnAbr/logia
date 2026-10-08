import Link from "next/link";

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/spaces"
      style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15, letterSpacing: "-.02em", color: "inherit", textDecoration: "none" }}
      className={className}
    >
      <span style={{ width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center", background: "linear-gradient(145deg, var(--coral), var(--accent-strong))", color: "#fff", fontSize: 14 }}>
        ✳
      </span>
      logia
    </Link>
  );
}