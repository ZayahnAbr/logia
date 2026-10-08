import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDeckStudyData } from "@/lib/queries";
import { DeckToolbar } from "./DeckToolbar";
import { DeckTabs } from "./DeckTabs";
import "../../practise-layout.css";

export default async function DeckPage({ params }: { params: Promise<{ id: string; deckId: string }> }) {
  const { id, deckId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");

  const data = await getDeckStudyData(id, deckId);
  if (!data) notFound();

  return (
    <DeckTabs
      spaceId={id}
      deckId={deckId}
      title={data.deck.title}
      folder={data.deck.subject}
      dueCards={data.dueNow}
      allCards={data.deck.cards_json ?? []}
      frontLanguage={data.deck.front_language}
      backLanguage={data.deck.back_language}
      toolbar={<DeckToolbar spaceId={id} deckId={deckId} front={data.deck.front_language ?? "en"} back={data.deck.back_language ?? "en"} />}
    />
  );
}
