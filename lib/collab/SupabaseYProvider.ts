"use client";

import * as Y from "yjs";
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

// Yjs transport over a Supabase Realtime broadcast channel (one per note).
// - document updates and cursor/presence ("awareness") go peer-to-peer through the channel
// - a newcomer asks for the current state; whoever is already editing replies with the diff
// - `synced` resolves once a peer has replied, or after a short wait if nobody else is here
const b64 = (u: Uint8Array) => { let s = ""; u.forEach((c) => { s += String.fromCharCode(c); }); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export class SupabaseYProvider {
  doc: Y.Doc;
  awareness: Awareness;
  channel: RealtimeChannel;
  synced: Promise<boolean>; // true = got state from a peer
  private resolveSynced!: (v: boolean) => void;
  private done = false;
  private live = false;
  private queue: [string, Record<string, unknown>][] = [];

  constructor(private supabase: SupabaseClient, noteId: string, doc: Y.Doc, user: { name: string; color: string }) {
    this.doc = doc;
    this.awareness = new Awareness(doc);
    this.awareness.setLocalStateField("user", user);
    this.synced = new Promise((r) => { this.resolveSynced = r; });
    this.channel = supabase.channel(`note:${noteId}`, { config: { broadcast: { self: false } } });

    doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwareness);

    this.channel
      .on("broadcast", { event: "y" }, ({ payload }) => Y.applyUpdate(doc, unb64(payload.u), this))
      .on("broadcast", { event: "aw" }, ({ payload }) => applyAwarenessUpdate(this.awareness, unb64(payload.u), this))
      .on("broadcast", { event: "sync-req" }, ({ payload }) => {
        const diff = Y.encodeStateAsUpdate(doc, unb64(payload.sv));
        this.send("sync-res", { to: payload.from, u: b64(diff), sv: b64(Y.encodeStateVector(doc)) });
        this.send("aw", { u: b64(encodeAwarenessUpdate(this.awareness, [doc.clientID])) });
      })
      .on("broadcast", { event: "sync-res" }, ({ payload }) => {
        if (payload.to !== doc.clientID) return;
        Y.applyUpdate(doc, unb64(payload.u), this);
        // Send back anything we have that they don't (both sides converge).
        const back = Y.encodeStateAsUpdate(doc, unb64(payload.sv));
        if (back.length > 2) this.send("y", { u: b64(back) });
        this.finish(true);
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        this.live = true;
        for (const [e, pl] of this.queue.splice(0)) this.send(e, pl);
        this.send("sync-req", { from: doc.clientID, sv: b64(Y.encodeStateVector(doc)) });
        window.setTimeout(() => this.finish(false), 900);
      });

    window.addEventListener("beforeunload", this.leave);
    // If Realtime never connects (blocked network), carry on from the saved note so editing still saves.
    window.setTimeout(() => this.finish(false), 2500);
  }

  private finish(fromPeer: boolean) { if (!this.done) { this.done = true; this.resolveSynced(fromPeer); } }
  private send(event: string, payload: Record<string, unknown>) {
    if (!this.live) { if (event === "y" || event === "aw") this.queue.push([event, payload]); return; }
    this.channel.send({ type: "broadcast", event, payload }).catch(() => {});
  }
  private onDocUpdate = (update: Uint8Array, origin: unknown) => { if (origin !== this) this.send("y", { u: b64(update) }); };
  private onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === this) return;
    this.send("aw", { u: b64(encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed])) });
  };
  private leave = () => removeAwarenessStates(this.awareness, [this.doc.clientID], "leave");

  destroy() {
    this.leave();
    window.removeEventListener("beforeunload", this.leave);
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwareness);
    this.supabase.removeChannel(this.channel);
    this.awareness.destroy();
  }
}
