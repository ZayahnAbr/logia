import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSpace, getFormulas } from "@/lib/queries";
import { FormulaSheet } from "./FormulaSheet";

export default async function FormulasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [space, formulas] = await Promise.all([getSpace(id), getFormulas(id)]);

  return (
    <>
      <div className="phead phead-grad">
        <div className="eyebrow">{space?.name}</div>
        <h1>Formula sheet</h1>
        <div className="sub">Collect the equations you need by topic, then print them for open-book exams.</div>
      </div>
      <FormulaSheet spaceId={id} formulas={formulas} />
    </>
  );
}
