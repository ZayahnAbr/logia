"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CLASSROOM_SCOPES } from "@/lib/classroomScopes";
import { toast } from "@/components/Toaster";
import { getClassroomStatus, removeClassroomItems, syncClassroom, type ClassroomStatus } from "@/app/classroom-actions";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Never");

// Google Classroom does not use the extension. It uses your Google sign-in, with read-only access.
export function ClassroomCard({ notice }: { notice?: { kind: "ok" | "error"; text: string } }) {
  const [status, setStatus] = useState<ClassroomStatus | null>(null);
  const [busy, setBusy] = useState<"" | "connect" | "sync" | "remove">("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(notice ?? null);

  const load = useCallback(async () => setStatus(await getClassroomStatus()), []);
  useEffect(() => { load(); }, [load]);

  const connect = async () => {
    setBusy("connect"); setMsg(null);
    const supabase = createClient();
    const options = {
      scopes: CLASSROOM_SCOPES,
      queryParams: { access_type: "offline", prompt: "consent" },
      redirectTo: `${window.location.origin}/auth/callback?next=/spaces/settings&classroom=1`,
    };
    // If you already sign in with Google, ask Google again for the extra access. Otherwise add Google to this account.
    const res = status?.hasGoogle
      ? await supabase.auth.signInWithOAuth({ provider: "google", options })
      : await supabase.auth.linkIdentity({ provider: "google", options });
    if (res.error) {
      const m = res.error.message.toLowerCase();
      setMsg({ kind: "error", text: m.includes("provider is not enabled") ? "Google sign-in isn't set up for this app yet." : m.includes("manual linking") ? "Linking Google to an existing account isn't switched on for this app yet." : res.error.message });
      setBusy("");
    }
    // On success the browser goes to Google.
  };

  const sync = async () => {
    setBusy("sync"); setMsg(null);
    const res = await syncClassroom();
    setBusy("");
    if ("error" in res) { setMsg({ kind: "error", text: res.error }); return; }
    setMsg({ kind: "ok", text: `Synced ${res.count} item${res.count === 1 ? "" : "s"} from Google Classroom.${res.undated ? ` ${res.undated} without a due date ${res.undated === 1 ? "was" : "were"} skipped.` : ""}` });
    load();
  };

  const remove = async () => {
    if (!window.confirm("Remove the Google Classroom items from Logia? This doesn't change anything in Classroom.")) return;
    setBusy("remove");
    const res = await removeClassroomItems();
    setBusy("");
    if (res.error) { toast(res.error, "error"); return; }
    toast("Classroom items removed", "success"); load();
  };

  return (
    <div className="card st-card" style={{ marginTop: 16 }}>
      <div className="st-row">
        <div>
          <strong>Google Classroom</strong>
          <span>Uses your Google sign-in with read-only access to your courses, assignments and whether you have handed them in. No extension needed. Logia can&apos;t post, edit or hand anything in for you.</span>
        </div>
        <button type="button" className="btn btn-primary" onClick={connect} disabled={busy !== ""}>
          {busy === "connect" && <Loader2 size={14} className="spin" aria-hidden="true" />} Connect Google Classroom
        </button>
      </div>

      <div className="st-row">
        <div>
          <strong>Last sync</strong>
          <span>{status === null ? "Loading" : `${fmt(status.lastSync)} · ${status.count} item${status.count === 1 ? "" : "s"} from Google Classroom`}</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={sync} disabled={busy !== ""}>
            {busy === "sync" ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />} Sync Classroom
          </button>
          {status !== null && status.count > 0 && (
            <button type="button" className="btn st-danger" onClick={remove} disabled={busy !== ""}><Trash2 size={14} aria-hidden="true" /> Remove items</button>
          )}
        </div>
      </div>

      {msg && <div className="st-row"><div><span role={msg.kind === "error" ? "alert" : "status"}>{msg.text}</span></div></div>}

      <div className="st-row" style={{ display: "block" }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          Connecting syncs straight away. Google only gives Logia access for about an hour and Logia doesn&apos;t keep it, so choose Sync Classroom within an hour of connecting, or connect again. Items already synced stay until you remove them.
          Google may show an &quot;unverified app&quot; warning until Logia is verified, and Google limits unverified apps that use these permissions to 100 people. To end access, remove Logia in your Google account&apos;s third-party access settings.
        </p>
      </div>
    </div>
  );
}
