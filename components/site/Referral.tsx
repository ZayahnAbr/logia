"use client";

import { useEffect } from "react";
import { claimReferral } from "@/app/growth-actions";
import { toast } from "@/components/Toaster";

const KEY = "logia.ref";

/** On public pages: remember ?ref=CODE so it survives the trip through sign-up. */
export function RefCapture() {
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref && /^[a-z0-9]{4,32}$/i.test(ref)) try { localStorage.setItem(KEY, ref.toLowerCase()); } catch { /* storage blocked */ }
  }, []);
  return null;
}

/** Inside the app: redeem a remembered invite once, then forget it. */
export function ReferralClaimer() {
  useEffect(() => {
    let code: string | null = null;
    try { code = localStorage.getItem(KEY); } catch { return; }
    if (!code) return;
    claimReferral(code).then((r) => {
      try { localStorage.removeItem(KEY); } catch { /* */ }
      toast(r.message, r.ok ? "success" : "error");
    });
  }, []);
  return null;
}
