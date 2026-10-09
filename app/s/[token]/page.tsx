import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import "../../workspace-layout.css";
import { ViewSpace, type ViewData } from "./ViewSpace";

// A view link (migration 40): anyone with the token can look at the space, no account needed.
export const metadata: Metadata = {
  title: "Shared space | Logia",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
};

const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

export default async function ViewLinkPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ resume?: string }> }) {
  const { token } = await params;
  const { resume } = await searchParams;
  const supabase = await createClient();

  let data: ViewData | null = null;
  if (TOKEN_RE.test(token)) {
    const { data: row } = await supabase.rpc("get_space_view", { p_token: token });
    data = (row as ViewData | null) ?? null;
  }

  if (!data) {
    return (
      <main id="main" className="vl-gone">
        <div className="vl-gone-card card">
          <h1>This link no longer works</h1>
          <p>The person who shared it may have stopped it, or the address may have been copied wrongly. Ask them for a new link.</p>
          <div className="vl-gone-actions">
            <Link href="/" className="btn btn-primary">Go to Logia</Link>
            <Link href="/auth/signin" className="btn">Sign in</Link>
          </div>
        </div>
      </main>
    );
  }

  const { data: { user } } = await supabase.auth.getUser();
  return <ViewSpace token={token} data={data} signedIn={!!user} resume={typeof resume === "string" ? resume.slice(0, 60) : null} />;
}
