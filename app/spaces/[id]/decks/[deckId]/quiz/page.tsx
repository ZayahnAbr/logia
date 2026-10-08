import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDeck } from "@/lib/queries";
import { QuizRunner } from "./QuizRunner";
import "../../../practise-layout.css";

export default async function QuizPage({ params }: { params: Promise<{ id: string; deckId: string }> }) {
  const { id, deckId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");
  const deck = await getDeck(deckId);
  if (!deck) notFound();
  return <QuizRunner spaceId={id} deckId={deckId} deckTitle={deck.title} />;
}
