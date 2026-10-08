"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== repeat) { setErr("Passwords don't match."); return; }
    setLoading(true); setErr(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setErr(error.message); setLoading(false); return; }
    router.push("/spaces");
  };

  return (
    <AuthShell kicker="Almost there" tagline="Choose a new password and you're back in.">
      <div className="auth-card auth-fade">

        <h1 className="auth-title">Set a new password</h1>
        <p className="auth-sub">Choose a new password for your account.</p>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <label>
            <span className="auth-label">New password</span>
            <input className="auth-input" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </label>
          <label>
            <span className="auth-label">Repeat password</span>
            <input className="auth-input" type="password" placeholder="••••••••" value={repeat} onChange={(e) => setRepeat(e.target.value)} required minLength={6} />
          </label>

          {err && <p className="auth-err">{err}</p>}

          <button className="auth-btn" type="submit" disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" /> : "Update password"}
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
