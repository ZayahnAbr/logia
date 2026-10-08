import "../learn-layout.css";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSpace, getLectures } from "@/lib/queries";
import { LecturesBoard } from "./LecturesBoard";

export default async function LecturesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [space, lectures] = await Promise.all([getSpace(id), getLectures(id)]);

  return (
    <>
      <div className="phead phead-grad ln-phead">
        <div className="eyebrow">{space?.name}</div>
        <h1>Lectures</h1>
        <div className="sub">Upload audio and get a transcript with AI study materials.</div>
      </div>
      <LecturesBoard spaceId={id} lectures={lectures as any} />
    </>
  );
}
