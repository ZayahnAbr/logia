import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSpace, getMindmaps } from "@/lib/queries";
import { MapsBoard } from "./MapsBoard";

export default async function MapsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [space, maps] = await Promise.all([getSpace(id), getMindmaps(id)]);

  return (
    <div className="wk-maps-page">
      <div className="phead phead-grad">
        <div className="eyebrow">{space?.name}</div>
        <h1>Mind maps</h1>
        <div className="sub">Turn any PDF into a visual, verified concept map.</div>
      </div>
      <MapsBoard spaceId={id} maps={maps as any} />
    </div>
  );
}
