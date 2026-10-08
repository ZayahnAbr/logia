"use server";

import { authed, isUnmetered } from "@/lib/server/llm";
import { pacingStatus, PACING, type PacingStatus } from "@/lib/server/pacing";
import { PROVIDERS } from "@/lib/server/providers";

export type AiPoolStatus = {
  pacing: PacingStatus;
  config: { weights: { quiet: number; moderate: number; peak: number }; reserveFraction: number; reserveFromHour: number; borrowFraction: number; fairShareBelow: number; batchPausedBelow: number };
  providers: { id: string; label: string; enabled: boolean }[];
};

/** Admin-only snapshot of the pooled AI budget: today's spend, this hour's share, reserve state and projected run-out. */
export async function getAiPoolStatus(): Promise<AiPoolStatus | { error: string }> {
  const { supabase, user } = await authed();
  if (!isUnmetered(user.email)) return { error: "Only admins can see this." };
  return {
    pacing: await pacingStatus(supabase),
    config: { weights: { quiet: PACING.weightQuiet, moderate: PACING.weightModerate, peak: PACING.weightPeak }, reserveFraction: PACING.reserveFraction, reserveFromHour: PACING.reserveFromHour, borrowFraction: PACING.borrowFraction, fairShareBelow: PACING.fairShareBelow, batchPausedBelow: PACING.batchPausedBelow },
    providers: PROVIDERS.map((p) => ({ id: p.id, label: p.label, enabled: p.enabled })),
  };
}
