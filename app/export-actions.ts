"use server";

import { createClient } from "@/lib/supabase/server";
import { blocksToDocx } from "@/lib/server/wordExport";
import { cleanBlocks, trimTrailing } from "@/lib/gdocBlocks";

// A .docx copy of a note. Google Docs, Word and Pages all open it, and Google Docs converts it when you
// drag it into Drive or choose Open with, so no Google or Microsoft permission is involved.
export async function noteToDocx(title: string, blocks: unknown): Promise<{ base64: string; filename: string } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in again to continue." };
  const clean = cleanBlocks(blocks);
  if (!clean) return { error: "That note could not be read." };
  try {
    const buf = await blocksToDocx((title ?? "").slice(0, 200), trimTrailing(clean));
    const name = (title ?? "").replace(/[^\w\- ]+/g, "").trim().slice(0, 80) || "note";
    return { base64: buf.toString("base64"), filename: `${name}.docx` };
  } catch {
    return { error: "Couldn't make the file. Try again." };
  }
}
