"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { createClient } from "@/lib/supabase/client";
import { Loader2, ArrowLeft } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setErr(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
    });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setSent(true);
  };

  return (
    <AuthShell kicker="Locked out?" tagline="We'll email you a link to get back into your study space.">
      <div className="auth-card auth-fade">

        {sent ? (
          <>
            <h1 className="auth-title">Check your email</h1>
            <p className="auth-sub">
              If an account exists for <strong>{email}</strong>, we&apos;ve sent a link to reset your password.
            </p>
          </>
        ) : (
          <>
            <h1 className="auth-title">Reset your password</h1>
            <p className="auth-sub">Enter your email and we&apos;ll send you a reset link.</p>

            <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <label>
                <span className="auth-label">Email</span>
                <input className="auth-input" type="email" placeholder="you@myuct.ac.za" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>

              {err && <p className="auth-err">{err}</p>}

              <button className="auth-btn" type="submit" disabled={loading}>
                {loading ? <Loader2 size={16} className="spin" /> : "Send reset link"}
              </button>
            </form>
          </>
        )}

        <div className="auth-alt">
          <Link href="/auth/signin" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--accent-text)", fontWeight: 600 }}>
            <ArrowLeft size={13} /> Back to sign in
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
