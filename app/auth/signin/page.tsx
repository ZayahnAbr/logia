"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { nextFromLocation, withNext } from "@/lib/safeNext";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setErr(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setErr(error.message); setLoading(false); return; }
    router.push(nextFromLocation() ?? "/spaces");
    router.refresh();
  };

  return (
    <AuthShell kicker="Welcome back" tagline="Your cards, notes and marked papers are where you left them.">
      <div className="auth-card auth-fade">

        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-sub">Sign in to pick up where you left off.</p>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <label>
            <span className="auth-label">Email</span>
            <input className="auth-input" type="email" placeholder="you@myuct.ac.za" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="auth-label">Password</span>
              <Link href="/auth/forgot-password" style={{ fontSize: 12, color: "var(--accent-text)", fontWeight: 500 }}>
                Forgot password?
              </Link>
            </div>
            <input className="auth-input" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>

          {err && <p className="auth-err">{err}</p>}

          <button className="auth-btn" type="submit" disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" style={{ display: "inline" }} /> : "Sign in"}
          </button>
        </form>

        <div className="auth-divider">or</div>
        <GoogleSignInButton />

        <div className="auth-alt">
          Don&apos;t have an account?{" "}
          <Link href="/auth/sign-up" onClick={(e) => { const n = nextFromLocation(); if (n) { e.preventDefault(); router.push(withNext("/auth/sign-up", n)); } }} style={{ color: "var(--accent-text)", fontWeight: 600 }}>Create one</Link>
        </div>
      </div>
    </AuthShell>
  );
}
