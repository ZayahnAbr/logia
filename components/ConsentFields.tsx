"use client";

import Link from "next/link";
import type { AgeChoice } from "@/lib/legal";

export type ConsentState = {
  age: AgeChoice;
  guardianEmail: string;
  guardianOk: boolean;
  agree: boolean;
};

export const emptyConsent: ConsentState = { age: "", guardianEmail: "", guardianOk: false, agree: false };

// Shared by the sign-up form and the "We've updated our terms" screen.
export function ConsentFields({ value, onChange }: { value: ConsentState; onChange: (v: ConsentState) => void }) {
  const set = (p: Partial<ConsentState>) => onChange({ ...value, ...p });
  return (
    <>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="auth-label">How old are you? <span className="field-req" aria-hidden="true">*</span></legend>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
          {([["18+", "I am 18 or older"], ["13-17", "I am 13 to 17"], ["under13", "I am under 13"]] as const).map(([v, label]) => (
            <label key={v} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 28 }}>
              <input type="radio" name="age" value={v} checked={value.age === v} onChange={() => set({ age: v })} required />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {value.age === "13-17" && (
        <>
          <label>
            <span className="auth-label">Parent or guardian&apos;s email <span className="field-req" aria-hidden="true">*</span></span>
            <input className="auth-input" type="email" autoComplete="off" value={value.guardianEmail} required
              onChange={(e) => set({ guardianEmail: e.target.value })} />
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" checked={value.guardianOk} onChange={(e) => set({ guardianOk: e.target.checked })} required style={{ marginTop: 4 }} />
            <span>My parent or guardian agrees to me using Logia</span>
          </label>
        </>
      )}

      <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <input type="checkbox" checked={value.agree} onChange={(e) => set({ agree: e.target.checked })} required style={{ marginTop: 4 }} />
        <span>
          I agree to the <Link href="/legal/terms" target="_blank" style={{ color: "var(--accent-text)", textDecoration: "underline" }}>Terms</Link> and
          the <Link href="/legal/acceptable-use" target="_blank" style={{ color: "var(--accent-text)", textDecoration: "underline" }}>Acceptable Use Policy</Link>,
          and I have read the <Link href="/legal/privacy" target="_blank" style={{ color: "var(--accent-text)", textDecoration: "underline" }}>Privacy Policy</Link>
        </span>
      </label>
    </>
  );
}

// Returns an error message, or null when the choices are complete and allowed.
export function validateConsent(c: ConsentState, looksLikeEmail: (s: string) => boolean): string | null {
  if (c.age === "under13") return "Sorry, Logia is for people aged 13 and older. Please come back when you are 13, or ask a parent or teacher for help finding another study tool.";
  if (!c.age) return "Please tell us if you are 18 or older.";
  if (c.age === "13-17") {
    if (!looksLikeEmail(c.guardianEmail)) return "Please enter your parent or guardian's email address.";
    if (!c.guardianOk) return "Please tick that your parent or guardian agrees to you using Logia.";
  }
  if (!c.agree) return "Please agree to the Terms and the Acceptable Use Policy to continue.";
  return null;
}
