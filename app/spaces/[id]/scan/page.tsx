import "../learn-layout.css";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSpace } from "@/lib/queries";
import { ScanBoard } from "./ScanBoard";

export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");
  const space = await getSpace(id);

  return (
    <>
      <div className="phead phead-grad ln-phead">
        <div className="eyebrow">{space?.name}</div>
        <h1>Scan</h1>
        <div className="sub">Photograph handwritten notes or printed pages, and Logia turns them into editable text.</div>
      </div>
      <ScanBoard spaceId={id} />
    </>
  );
}
