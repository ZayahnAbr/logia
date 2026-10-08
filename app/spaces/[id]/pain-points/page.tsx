import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSpace, getPainPoints } from "@/lib/queries";
import { PainPointsBoard } from "./PainPointsBoard";
import "../practise-layout.css";

export default async function PainPointsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");

  const [space, points] = await Promise.all([getSpace(id), getPainPoints(id)]);

  return (
    <>
      <div className="phead phead-grad">
        <div className="eyebrow">{space?.name}</div>
        <h1>Pain points</h1>
        <div className="sub">The mistakes you keep making, collected from your marked papers and added by you. Fix them before the test.</div>
      </div>
      <PainPointsBoard spaceId={id} points={points} />
    </>
  );
}
