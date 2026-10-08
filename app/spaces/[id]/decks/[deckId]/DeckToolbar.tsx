"use client";

import { useState } from "react";
import Link from "next/link";
import { ListChecks, Languages } from "lucide-react";
import { updateDeckLanguages } from "@/app/actions";
import { LANGUAGES } from "@/lib/languages";

export function DeckToolbar({ spaceId, deckId, front, back }: { spaceId: string; deckId: string; front: string; back: string }) {
  const [f, setF] = useState(front);
  const [b, setB] = useState(back);

  const save = (nf: string, nb: string) => { setF(nf); setB(nb); updateDeckLanguages(spaceId, deckId, nf, nb); };

  const select = (value: string, onPick: (v: string) => void) => (
    <select className="input" value={value} onChange={(e) => onPick(e.target.value)} style={{ height: 32, width: "auto", fontSize: 12.5, padding: "0 8px" }}>
      {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
    </select>
  );

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <Link href={`/spaces/${spaceId}/decks/${deckId}/quiz`} className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>
        <ListChecks size={14} /> Take a practice quiz
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 12.5, color: "var(--muted)" }}>
        <Languages size={14} /> Front {select(f, (v) => save(v, b))} Back {select(b, (v) => save(f, v))}
      </div>
    </div>
  );
}
