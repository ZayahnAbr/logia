"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Flag, Pencil, Trash2 } from "lucide-react";
import { ShareButton } from "@/components/ShareSheet";
import { Dialog } from "@/components/Dialog";
import { toast } from "@/components/Toaster";
import { deleteUserCafe } from "@/app/cafe-actions";
import { STATUS_LABEL, type CafeStatus } from "@/lib/userCafes";
import { ReportDialog } from "../../ReportDialog";

// Owner tools (share, edit, delete) or a report button for everyone else.
export function UserCafeTools({ id, name, description, owner, status }: { id: string; name: string; description: string; owner: boolean; status: CafeStatus }) {
  const router = useRouter();
  const [reporting, setReporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    const res = await deleteUserCafe(id);
    setBusy(false);
    if (res.error) { toast(res.error, "error"); return; }
    toast("Room deleted.");
    router.push("/discover?tab=rooms");
  };

  if (!owner) {
    return (
      <>
        <button type="button" className="btn btn-sm" onClick={() => setReporting(true)}><Flag size={15} aria-hidden="true" /> Report this room</button>
        {reporting && <ReportDialog kind="user_cafe" targetId={id} onClose={() => setReporting(false)} />}
      </>
    );
  }
  return (
    <>
      <span className="cafe-badge">{STATUS_LABEL[status]}</span>
      <ShareButton className="btn btn-sm"label="Share link" note="Anyone signed in to Logia with this link can join."
        get={async () => ({ title: name, text: description || "Study with me on Logia", url: `${window.location.origin}/discover/c/${id}` })} />
      <Link href={`/discover/host?edit=${id}`} className="btn btn-sm"><Pencil size={15} aria-hidden="true" /> Edit</Link>
      <button type="button" className="btn btn-sm" onClick={() => setConfirming(true)}><Trash2 size={15} aria-hidden="true" /> Delete</button>
      {confirming && (
        <Dialog title="Delete this room?" onClose={() => setConfirming(false)} width={420}>
          <p style={{ color: "var(--muted)", margin: "8px 0 16px" }}>The room, its chat and any uploaded video or music will be removed. This cannot be undone.</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>Keep it</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={remove}>{busy ? "Deleting…" : "Delete room"}</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
