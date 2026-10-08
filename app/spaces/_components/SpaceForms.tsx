"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSpace, joinSpace } from "@/app/actions";

export function SpaceForms() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const create = () =>
    start(async () => {
      setErr(null);
      const res = await createSpace(name.trim(), subject.trim(), "peer");
      if (res.error) return setErr(res.error);
      setName(""); setSubject("");
      if (res.id) router.push(`/spaces/${res.id}`);
    });

  const join = () =>
    start(async () => {
      setErr(null);
      const res = await joinSpace(code.trim());
      if (res.error) return setErr(res.error);
      setCode("");
      if (res.id) router.push(`/spaces/${res.id}`);
    });

  const panel: React.CSSProperties = {
    padding: "20px 22px",
    background: "var(--surface)",
    border: "none",
    borderRadius: 16,
    boxShadow: "var(--shadow)",
  };

  return (
    <div className="grid2" data-tour="create-space">
      <div style={panel}>
        <div className="sec-title" style={{ marginBottom: 14 }}>New Peer Space</div>
        <div style={{ display: "grid", gap: 10 }}>
          <input
            className="input"
            placeholder="Name, e.g. IS Honours Study Circle"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="input"
            placeholder="Subject (optional)"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <button
            className="btn btn-primary"
            onClick={create}
            disabled={pending || !name.trim()}
            style={{ justifySelf: "start" }}
          >
            Create Space
          </button>
        </div>
      </div>

      <div style={panel}>
        <div className="sec-title" style={{ marginBottom: 14 }}>Join with a code</div>
        <div style={{ display: "grid", gap: 10 }}>
          <input
            className="input mono"
            placeholder="Invite code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button
            className="btn"
            onClick={join}
            disabled={pending || !code.trim()}
            style={{ justifySelf: "start" }}
          >
            Join Space
          </button>
        </div>
      </div>

      {err && <div className="err" style={{ gridColumn: "1 / -1" }}>{err}</div>}
    </div>
  );
}
