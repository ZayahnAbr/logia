import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPaperQuestions, getAttemptsForSpace } from "@/lib/queries";
import { PaperView } from "./PaperView";
import "../../practise-layout.css";

export default async function PaperDetailPage({ params }: { params: Promise<{ id: string; paperId: string }> }) {
  const { id, paperId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");

  const { data: paper } = await supabase.from("past_papers").select("title").eq("id", paperId).single();
  if (!paper) notFound();

  const [questions, attempts] = await Promise.all([getPaperQuestions(paperId), getAttemptsForSpace(id)]);

  return (
    <PaperView spaceId={id} paperId={paperId} title={paper.title} questions={questions} attempts={attempts} />
  );
}
