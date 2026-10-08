import { redirect } from "next/navigation";
import "../workspace-layout.css";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { getLibraryBooks } from "@/lib/queries";
import { LibraryBoard } from "./LibraryBoard";

export default async function LibraryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");
  const books = await getLibraryBooks();

  return (
    <AppShell>
      <div className="phead">
        <div className="eyebrow">Library</div>
        <h1>Your textbooks</h1>
        <div className="sub">A private shelf for your PDFs and EPUBs. Highlight passages, bookmark pages and pick up where you left off.</div>
      </div>
      <LibraryBoard books={books} />
    </AppShell>
  );
}
