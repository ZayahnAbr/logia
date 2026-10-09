"use client";

import { useRef, useState } from "react";
import { Check, Loader2, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { uploadFile, createLectureRecord } from "@/app/actions";
import { compressAudioFile } from "@/app/spaces/[id]/lectures/compressAudio";

export type UploadKind = "files" | "outlines" | "recordings";

const COPY: Record<UploadKind, { title: string; hint: string; accept?: string; folder?: string }> = {
  files: { title: "Your files", hint: "Notes, documents and slides", folder: "General" },
  outlines: { title: "Course outlines and PDFs", hint: "PDF, Word or PowerPoint", accept: ".pdf,.doc,.docx,.ppt,.pptx", folder: "Course outlines" },
  recordings: { title: "Lecture recordings", hint: "Audio or video", accept: "audio/*,video/*" },
};

type Item = { name: string; state: "busy" | "done" | "error"; msg?: string };

// A real upload into the student's first space. Everything is optional and runs in the background of the step.
export function OnboardingUploads({ spaceId, kinds }: { spaceId: string; kinds: UploadKind[] }) {
  const [items, setItems] = useState<Record<UploadKind, Item[]>>({ files: [], outlines: [], recordings: [] });
  const refs = useRef<Record<string, HTMLInputElement | null>>({});

  const patch = (k: UploadKind, name: string, p: Partial<Item>) =>
    setItems((cur) => ({ ...cur, [k]: cur[k].map((i) => (i.name === name ? { ...i, ...p } : i)) }));

  const upload = async (k: UploadKind, file: File) => {
    setItems((cur) => ({ ...cur, [k]: [...cur[k], { name: file.name, state: "busy" }] }));
    try {
      if (k === "recordings") {
        const compressed = await compressAudioFile(file);
        const path = `${spaceId}/audio-${crypto.randomUUID()}-${compressed.name}`;
        const { error } = await createClient().storage.from("space-files").upload(path, compressed, { contentType: "audio/mp3", upsert: false });
        if (error) throw error;
        const res = await createLectureRecord(spaceId, file.name.replace(/\.[^.]+$/, ""), path);
        if (res.error) throw new Error(res.error);
      } else {
        const fd = new FormData();
        fd.set("spaceId", spaceId); fd.set("folder", COPY[k].folder ?? "General"); fd.set("file", file);
        const res = await uploadFile(fd);
        if ("error" in res && res.error) throw new Error(res.error);
      }
      patch(k, file.name, { state: "done" });
    } catch (e) {
      patch(k, file.name, { state: "error", msg: e instanceof Error ? e.message : "That didn't upload." });
    }
  };

  return (
    <div className="ob-ups">
      {kinds.map((k) => (
        <div key={k} className="ob-up">
          <div className="ob-up-head">
            <div><b>{COPY[k].title}</b><span>{COPY[k].hint}</span></div>
            <button type="button" className="btn" onClick={() => refs.current[k]?.click()}><Upload size={14} aria-hidden="true" /> Choose</button>
            <input ref={(el) => { refs.current[k] = el; }} type="file" multiple hidden accept={COPY[k].accept} aria-label={`Choose ${COPY[k].title.toLowerCase()}`}
              onChange={(e) => { Array.from(e.target.files ?? []).forEach((f) => upload(k, f)); e.target.value = ""; }} />
          </div>
          {items[k].length > 0 && (
            <ul className="ob-up-list" aria-live="polite">
              {items[k].map((i) => (
                <li key={i.name}>
                  {i.state === "busy" ? <Loader2 size={14} className="spin" aria-hidden="true" /> : i.state === "done" ? <Check size={14} aria-hidden="true" /> : <span aria-hidden="true">!</span>}
                  <span className="ob-up-name">{i.name}</span>
                  <span className="ob-up-state">{i.state === "busy" ? "Uploading…" : i.state === "done" ? "Added" : i.msg}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
