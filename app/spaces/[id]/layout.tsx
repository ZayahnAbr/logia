import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSpace } from "@/lib/queries";
import { AppShell } from "@/components/AppShell";
import type { ReactNode } from "react";

export default async function SpaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // Independent reads — run together instead of waiting on each in turn.
  // Falls back gracefully if the `persona` column is missing (migration 09 not run).
  const [space, { data: prof }, { data: personaRow }] = await Promise.all([
    getSpace(id),
    supabase.from("profiles").select("onboarding_completed").eq("id", user.id).single(),
    supabase.from("profiles").select("persona").eq("id", user.id).maybeSingle(),
  ]);
  if (!space) notFound();

  return (
    <AppShell spaceId={id} spaceName={space.name} showTour={!prof?.onboarding_completed} askPersona={personaRow !== null && !personaRow.persona}>
      {children}
    </AppShell>
  );
}
