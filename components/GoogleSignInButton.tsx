"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";
import { nextFromLocation } from "@/lib/safeNext";

function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.1 0-11-4.9-11-11s4.9-11 11-11c2.8 0 5.3 1 7.3 2.7l6-6C34 6.5 29.3 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 16 18.9 13 24 13c2.8 0 5.3 1 7.3 2.7l6-6C34 6.5 29.3 4.5 24 4.5c-7.7 0-14.4 4.4-17.7 10.2z" />
      <path fill="#4CAF50" d="M24 43.5c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.5 2.2-7.2 2.2-5.3 0-9.7-3.4-11.3-8.1l-6.5 5C8.6 38.9 15.7 43.5 24 43.5z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.4l6.2 5.2C40.8 36 43.5 30.6 43.5 24c0-1.2-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function GoogleSignInButton({ label = "Continue with Google" }: { label?: string }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const signIn = async () => {
    setLoading(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextFromLocation() ?? "/spaces")}` },
    });
    if (error) {
      setErr(
        error.message.toLowerCase().includes("provider is not enabled")
          ? "Google sign-in isn't set up yet for this app."
          : error.message
      );
      setLoading(false);
    }
    // On success (no error) the browser navigates away to Google; no need to reset loading.
  };

  return (
    <div>
      <button type="button" className="auth-btn-outline" onClick={signIn} disabled={loading}>
        {loading ? <Loader2 size={16} className="spin" /> : <><GoogleIcon /> {label}</>}
      </button>
      {err && <p className="auth-err" style={{ marginTop: 10, textAlign: "center" }}>{err}</p>}
    </div>
  );
}
