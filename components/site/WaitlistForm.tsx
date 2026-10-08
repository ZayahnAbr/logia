"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { joinWaitlist } from "@/app/growth-actions";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("busy"); setErr(null);
    const res = await joinWaitlist(email);
    if ("error" in res && res.error) { setErr(res.error); setState("idle"); return; }
    setState("done");
  };

  if (state === "done") {
    return (
      <p role="status" className="wl-done"><Check size={16} aria-hidden="true" /> You&apos;re on the list. We&apos;ll email <strong>{email.trim()}</strong> before paid plans open.</p>
    );
  }
  return (
    <form onSubmit={submit} className="wl-form" noValidate>
      <label htmlFor="wl-email" className="sr-only">Email address</label>
      <input id="wl-email" className="input" type="email" autoComplete="email" required placeholder="you@university.ac.za" value={email}
        onChange={(e) => { setEmail(e.target.value); setErr(null); }} aria-invalid={!!err} aria-describedby={err ? "wl-err" : "wl-hint"} />
      <button className="btn btn-primary" disabled={state === "busy" || !email.trim()}>
        {state === "busy" && <Loader2 size={14} className="spin" aria-hidden="true" />} Join the waitlist
      </button>
      {err ? <p id="wl-err" className="field-error wl-msg">{err}</p> : <p id="wl-hint" className="field-hint wl-msg">No spam. One email when paid plans open.</p>}
    </form>
  );
}
