import "../learn-layout.css";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSpace, getFiles } from "@/lib/queries";
import { FilesBoard } from "./FilesBoard";

export default async function FilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [space, files] = await Promise.all([getSpace(id), getFiles(id)]);
  const folders = [...new Set((files ?? []).map((f: any) => f.folder).filter(Boolean))] as string[];

  return (
    <>
      <div className="phead phead-grad ln-phead">
        <div className="eyebrow">{space?.name}</div>
        <h1>Files</h1>
        <div className="sub">Slides, PDFs and other uploaded materials.</div>
      </div>
      <FilesBoard spaceId={id} files={files as any} folders={folders} />
    </>
  );
}
