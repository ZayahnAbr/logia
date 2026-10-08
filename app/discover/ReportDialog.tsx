"use client";

import { useState } from "react";
import { Dialog } from "@/components/Dialog";
import { toast } from "@/components/Toaster";
import { reportContent, type ReportKind } from "@/app/discover-actions";

const LABEL: Record<ReportKind, string> = { cafe_message: "message", space: "space", stream: "stream", user_cafe: "room" };

// One report form for messages, spaces and streams. Admins review them on /discover/admin.
export function ReportDialog({ kind, targetId, onClose }: { kind: ReportKind; targetId: string; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await reportContent(kind, targetId, reason);
    setBusy(false);
    if (res.error) { toast(res.error, "error"); return; }
    toast("Thanks. An admin will take a look.");
    onClose();
  };

  return (
    <Dialog title={`Report this ${LABEL[kind]}`} onClose={onClose} width={440}>
      <form onSubmit={submit} className="field" style={{ marginTop: 8 }}>
        <label className="field-label" htmlFor="report-reason">What is wrong? (optional)</label>
        <textarea id="report-reason" className="input" rows={4} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="For example: rude language, spam, not study related" style={{ resize: "vertical" }} />
        <div className="field-hint">{reason.length}/500</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : "Send report"}</button>
        </div>
      </form>
    </Dialog>
  );
}
