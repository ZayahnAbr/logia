"use client";

import { hasBlockedWord } from "@/lib/moderation";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "@/components/AuthShell";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { RefCapture } from "@/components/site/Referral";
import { nextFromLocation, withNext } from "@/lib/safeNext";
import { ConsentFields, emptyConsent, validateConsent, type ConsentState } from "@/components/ConsentFields";
import { TERMS_VERSION, looksLikeEmail } from "@/lib/legal";

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat]     = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [consent, setConsent]   = useState<ConsentState>(emptyConsent);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== repeat) { setError("Passwords don't match."); return; }
    const consentErr = validateConsent(consent, looksLikeEmail);
    if (consentErr) { setError(consentErr); return; }
    if (hasBlockedWord(name)) { setError("Please choose a different name."); return; }
    setLoading(true); setError(null);
    const supabase = createClient();
    const next = nextFromLocation();
    const acceptedAt = new Date().toISOString();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}${next ?? "/spaces"}`,
        data: {
          display_name: name,
          terms_version: TERMS_VERSION,
          terms_accepted_at: acceptedAt,
          age_band: consent.age,
          ...(consent.age === "13-17" ? { guardian_email: consent.guardianEmail.trim() } : {}),
        },
      },
    });
    if (error) { setError(error.message); setLoading(false); return; }
    if (name && data.user) {
      await supabase.from("profiles").update({ display_name: name }).eq("id", data.user.id);
    }
    if (data.user && data.session) {
      // Before migration 44 these columns don't exist and the update just fails; the terms screen then asks on first visit.
      await supabase.from("profiles").update({
        terms_version: TERMS_VERSION, terms_accepted_at: acceptedAt, age_band: consent.age,
        ...(consent.age === "13-17" ? { guardian_email: consent.guardianEmail.trim(), guardian_consent_at: acceptedAt } : {}),
      }).eq("id", data.user.id);
    }
    // With "Confirm email" off in Supabase, signUp returns a live session — go straight in.
    if (data.session) { router.push(next ?? "/spaces"); router.refresh(); return; }
    router.push("/auth/sign-up-success");
  };

  return (
    <AuthShell kicker="Create your free account" tagline="Sign up in seconds and set up your first study space.">
      <RefCapture />
      <div className="auth-card auth-fade">
        <h1 className="auth-title">Create your account</h1>
        <p className="auth-sub">Free during the beta. No card needed.</p>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Full name" type="text" autoComplete="name" value={name} onChange={setName} />
          <Field label="Email" type="email" autoComplete="email" value={email} onChange={setEmail} />
          <Field label="Password" type="password" autoComplete="new-password" hint="At least 6 characters" value={password} onChange={setPassword} />
          <Field label="Repeat password" type="password" autoComplete="new-password" value={repeat} onChange={setRepeat} />

          <ConsentFields value={consent} onChange={setConsent} />

          {error && <p role="alert" className="auth-err">{error}</p>}

          <button className="auth-btn" type="submit" disabled={loading} aria-busy={loading}>
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <div className="auth-divider">or</div>
        <GoogleSignInButton label="Sign up with Google" />

        <div className="auth-alt">
          Already have an account?{" "}
          <Link href="/auth/signin" onClick={(e) => { const n = nextFromLocation(); if (n) { e.preventDefault(); router.push(withNext("/auth/signin", n)); } }} style={{ color: "var(--accent-text)", fontWeight: 600 }}>Sign in</Link>
        </div>
      </div>
    </AuthShell>
  );
}

function Field({
  label, type, value, onChange, autoComplete, hint,
}: {
  label: string; type: string; value: string; onChange: (v: string) => void; autoComplete?: string; hint?: string;
}) {
  return (
    <label>
      <span className="auth-label">{label} <span className="field-req" aria-hidden="true">*</span></span>
      <input className="auth-input" type={type} value={value} autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)} required minLength={type === "password" ? 6 : undefined} />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
