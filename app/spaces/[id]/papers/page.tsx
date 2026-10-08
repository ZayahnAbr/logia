import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSpace, getPastPapers } from "@/lib/queries";
import { PapersBoard } from "./PapersBoard";
import "../practise-layout.css";

export default async function PapersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [space, papers] = await Promise.all([getSpace(id), getPastPapers(id)]);

  return (
    <>
      <div className="phead phead-grad">
        <div className="eyebrow">{space?.name}</div>
        <h1>Past papers</h1>
        <div className="sub">Upload a paper you&apos;ve written and its memo. Logia marks it and shows where you lost marks.</div>
      </div>
      <PapersBoard spaceId={id} papers={papers} />
    </>
  );
}
