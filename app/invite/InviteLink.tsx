"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { ShareButton } from "@/components/ShareSheet";

export function InviteLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* blocked */ }
  };
  return (
    <div className="invite-link">
      <label htmlFor="invite-url" className="sr-only">Your invite link</label>
      <input id="invite-url" className="input mono" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" onClick={copy}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} {copied ? "Copied" : "Copy link"}</button>
        <ShareButton label="Share" className="btn l-btn-soft"
          data={{ title: "Join me on Logia", text: "I'm using Logia to turn my notes into flashcards that test me. Join with my link and we both get bonus study time.", url }} />
      </div>
    </div>
  );
}
