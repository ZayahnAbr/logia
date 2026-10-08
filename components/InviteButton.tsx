"use client";

import { useState } from "react";
import { Check, UserPlus } from "lucide-react";
import { ShareButton } from "@/components/ShareSheet";

// Copies a space's invite code so classmates can join it from their dashboard.
export function InviteButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  };
  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
    <ShareButton iconOnly label="Share invite" className="btn btn-sm btn-icon" note="They paste the code under “Join a space” on their dashboard."
      data={{ title: "Join my study space on Logia", text: `Use invite code ${code} under “Join a space”.`, url: typeof window !== "undefined" ? `${window.location.origin}/spaces` : undefined }} />
    <button className="btn btn-sm" onClick={copy} title="Classmates paste this code under Join a space">
      {copied ? <Check size={14} aria-hidden="true" /> : <UserPlus size={14} aria-hidden="true" />}
      {copied ? "Code copied" : <>Invite classmates · <span className="mono">{code}</span></>}
      <span className="sr-only" role="status">{copied ? "Invite code copied" : ""}</span>
    </button>
    </span>
  );
}
