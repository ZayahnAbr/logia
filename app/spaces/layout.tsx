import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { TermsGate } from "@/components/TermsGate";
import { TERMS_VERSION } from "@/lib/legal";

// One fixed look (white + coral) — colours come straight from globals.css, no runtime theming.
export default async function SpacesLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");

  // Terms gate (migration 44). If the columns don't exist yet the query errors and we let the user through.
  const { data: prof, error } = await supabase.from("profiles").select("terms_version, age_band").eq("id", user.id).maybeSingle();
  if (!error && prof && prof.terms_version !== TERMS_VERSION) {
    const m = (user.user_metadata ?? {}) as Record<string, unknown>;
    if (m.terms_version === TERMS_VERSION && (m.age_band === "18+" || m.age_band === "13-17")) {
      // Accepted at sign-up but the profile could not be written then (e-mail confirmation was on): copy it over now.
      const now = new Date().toISOString();
      const row: Record<string, unknown> = { terms_version: TERMS_VERSION, terms_accepted_at: typeof m.terms_accepted_at === "string" ? m.terms_accepted_at : now, age_band: m.age_band };
      if (m.age_band === "13-17" && typeof m.guardian_email === "string") { row.guardian_email = m.guardian_email.slice(0, 254); row.guardian_consent_at = now; }
      await supabase.from("profiles").update(row).eq("id", user.id);
    } else {
      return <TermsGate needsAge={!prof.age_band} />;
    }
  }
  return <>{children}</>;
}
