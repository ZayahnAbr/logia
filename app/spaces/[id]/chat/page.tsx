import "../learn-layout.css";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSpace } from "@/lib/queries";
import { ChatBoard } from "./ChatBoard";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const space = await getSpace(id);

  const { count } = await supabase
    .from("content_chunks")
    .select("*", { count: "exact", head: true })
    .eq("space_id", id);

  return (
    <>
      <div className="phead phead-grad ln-phead">
        <div className="eyebrow">{space?.name}</div>
        <h1>Ask Logia</h1>
        <div className="sub">Ask about anything in this space. Every answer cites its source.</div>
      </div>
      <ChatBoard spaceId={id} indexedCount={count ?? 0} />
    </>
  );
}
