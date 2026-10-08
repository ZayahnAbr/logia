import type { ReactNode } from "react";

// Plain light backdrop — the coral gradient lives inside each auth card's side panel.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <div style={{ minHeight: "100vh", background: "var(--surface-2)" }}>{children}</div>;
}
