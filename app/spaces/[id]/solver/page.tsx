import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSpace } from "@/lib/queries";
import { SolverBoard } from "./SolverBoard";
import "../practise-layout.css";

export default async function SolverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const space = await getSpace(id);

  return (
    <>
      <div className="phead phead-grad">
        <div className="eyebrow">{space?.name}</div>
        <h1>Solver</h1>
        <div className="sub">Type an expression and get a step-by-step answer, powered by Newton API.</div>
      </div>
      <SolverBoard />
    </>
  );
}
