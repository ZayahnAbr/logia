"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConsentFields, emptyConsent, validateConsent, type ConsentState } from "@/components/ConsentFields";
import { acceptTerms } from "@/app/consent-actions";
import { looksLikeEmail } from "@/lib/legal";

// One-time "We've updated our terms" screen shown on a signed-in visit until the current version is accepted.
export function TermsGate({ needsAge }: { needsAge: boolean }) {
  const router = useRouter();
  const [c, setC] = useState<ConsentState>(emptyConsent);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validateConsent(c, looksLikeEmail);
    if (v) { setErr(v); return; }
    setBusy(true); setErr(null);
    const r = await acceptTerms({ age: c.age, guardianEmail: c.guardianEmail, guardianOk: c.guardianOk });
    if (!r.ok) { setErr(r.error ?? "Something went wrong."); setBusy(false); return; }
    router.refresh();
  };

  return (
    <main id="main" style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 16, background: "var(--bg)" }}>
      <div className="card" style={{ maxWidth: 480, width: "100%", padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h1 style={{ fontSize: "1.5rem", margin: 0 }}>We&apos;ve updated our terms</h1>
        <p style={{ margin: 0 }}>
          {needsAge ? "Before you carry on, please read and accept our terms and tell us your age." : "Please read and accept our terms to carry on using Logia."}
        </p>
        <ConsentFields value={c} onChange={setC} />
        {err && <p role="alert" className="auth-err">{err}</p>}
        <button className="auth-btn" type="submit" disabled={busy} aria-busy={busy}>{busy ? "Saving…" : "Accept and continue"}</button>
      </form>
        <form action="/auth/signout" method="post"><button type="submit" className="btn">Sign out</button></form>
      </div>
    </main>
  );
}
