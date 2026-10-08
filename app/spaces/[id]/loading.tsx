export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="skeleton" style={{ height: 28, width: 220, borderRadius: 8 }} />
      <div className="skeleton card" style={{ height: 72 }} />
      <div className="skeleton card" style={{ height: 72 }} />
      <div className="skeleton card" style={{ height: 72 }} />
      <div className="skeleton card" style={{ height: 72 }} />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
