"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { uploadBlocked, checkUploaded } from "@/lib/uploadSafety";
import { Brush, Check, Clapperboard, Image as ImageIcon, Link2, Loader2, Music, Upload, VolumeX, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/Toaster";
import { LOOP_SRC, POSTER, SCENE_IDS, SCENE_LABEL } from "@/lib/loopScenes";
import { toEmbed } from "@/lib/musicEmbed";
import { createUserCafe, updateUserCafe } from "@/app/cafe-actions";
import { parseCoverDoc, type CoverDoc } from "@/lib/coverDoc";
import { BG_SWATCHES, DEFAULT_BG, IMAGE_MAX_BYTES, colorVeil, type LoopKind, type SceneId } from "@/lib/userCafes";

// Loaded only when opened, so the handwriting fonts and editor code stay out of the rest of the form.
const CoverEditor = dynamic(() => import("./CoverEditor"), { ssr: false });
const MAX_BYTES = 60 * 1024 * 1024;
const PRESETS: { id: SceneId; label: string }[] = SCENE_IDS.map((id) => ({ id, label: SCENE_LABEL[id] }));
const LENGTHS = [{ f: 25, b: 5 }, { f: 50, b: 10 }, { f: 45, b: 15 }];
const IMAGE_EXT_BY_TYPE: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const KINDS: { k: LoopKind; label: string }[] = [
  { k: "preset", label: "Preset loop" }, { k: "upload", label: "Upload video" }, { k: "image", label: "Upload picture" }, { k: "color", label: "Solid colour" },
];
const VIDEO_EXT:Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm" };
const AUDIO_EXT: Record<string, string> = { "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav" };

export type HostInitial = {
  id: string; name: string; description: string;
  loopKind: LoopKind; preset: SceneId; loopPath: string | null; loopUrl: string | null; bgColor: string | null;
  musicKind: "none" | "link" | "upload"; musicUrl: string; musicPath: string | null; audioUrl: string | null;
  focus: number; brk: number; listing: "unlisted" | "pending";
  coverPath: string | null; coverUrl: string | null; coverDoc: unknown;
};

type Cover = { path: string; preview: string; doc: CoverDoc | null };
type Uploaded = { path: string; preview: string; name: string };

// Upload straight from the browser to the private bucket, with progress.
async function uploadWithProgress(file: File, path: string, onProgress: (pct: number) => void): Promise<string | null> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return "Please sign in again.";
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/cafe-media/${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve(null);
      let msg = "The upload failed. Try again.";
      try { const j = JSON.parse(xhr.responseText); if (/bucket not found/i.test(j.message ?? j.error ?? "")) msg = "Uploads need a database update. Run migration-23-user-cafes.sql and migration-24-cafe-backgrounds.sql."; } catch { /* keep default */ }
      resolve(msg);
    };
    xhr.onerror = () => resolve("The upload failed. Check your connection and try again.");
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", file);
    xhr.send(form);
  });
}

export function HostForm({ uid, initial }: { uid: string; initial?: HostInitial }) {
  // Reduced motion: show the still instead of playing the loop.
  const [stillOnly, setStillOnly] = useState(false);
  useEffect(() => { setStillOnly(window.matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);
  const router = useRouter();
  const uidFor = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [loopKind, setLoopKind] = useState<LoopKind>(initial?.loopKind ?? "preset");
  const [preset, setPreset] = useState<SceneId>(initial?.preset ?? "rain-roof");
  const [loop, setLoop] = useState<Uploaded | null>(initial?.loopKind === "upload" && initial.loopPath && initial.loopUrl ? { path: initial.loopPath, preview: initial.loopUrl, name: "Current loop" } : null);
  const [image, setImage] = useState<Uploaded | null>(initial?.loopKind === "image" && initial.loopPath && initial.loopUrl ? { path: initial.loopPath, preview: initial.loopUrl, name: "Current picture" } : null);
  const [bgColor, setBgColor] = useState(initial?.bgColor ?? DEFAULT_BG);
  const [musicKind, setMusicKind] = useState<"none" | "link" | "upload">(initial?.musicKind ?? "none");
  const [musicUrl, setMusicUrl] = useState(initial?.musicUrl ?? "");
  const [track, setTrack] = useState<Uploaded | null>(initial?.musicPath && initial.audioUrl ? { path: initial.musicPath, preview: initial.audioUrl, name: "Current track" } : null);
  const [focus, setFocus] = useState(initial?.focus ?? 25);
  const [brk, setBrk] = useState(initial?.brk ?? 5);
  const [custom, setCustom] = useState(initial ? !LENGTHS.some((l) => l.f === initial.focus && l.b === initial.brk) : false);
  const [listing, setListing] = useState<"unlisted" | "pending">(initial?.listing ?? "unlisted");
  const [cover, setCover] = useState<Cover | null>(initial?.coverPath && initial.coverUrl ? { path: initial.coverPath, preview: initial.coverUrl, doc: parseCoverDoc(initial.coverDoc) } : null);
  const [coverTouched, setCoverTouched] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [progress, setProgress] = useState<{ loop?: number; image?: number; track?: number; cover?: number }>({});
  const [busy, setBusy] = useState(false);
  // Files uploaded in this session that were never saved; removed if replaced or dropped.
  const fresh = useRef<Set<string>>(new Set());

  const embed = useMemo(() => (musicKind === "link" && musicUrl.trim() ? toEmbed(musicUrl) : null), [musicKind, musicUrl]);

  const discard = (path: string | undefined) => {
    if (path && fresh.current.has(path)) { fresh.current.delete(path); void createClient().storage.from("cafe-media").remove([path]); }
  };

  const pick = async (file: File | undefined, kind: "loop" | "image" | "track") => {
    if (!file) return;
    const ext = (kind === "loop" ? VIDEO_EXT : kind === "image" ? IMAGE_EXT_BY_TYPE : AUDIO_EXT)[file.type];
    if (!ext) { toast(kind === "loop" ? "Choose an mp4 or webm video." : kind === "image" ? "Choose a JPG, PNG or WebP picture." : "Choose an mp3, m4a, ogg or wav track.", "error"); return; }
    if (file.size > (kind === "image" ? IMAGE_MAX_BYTES : MAX_BYTES)) { toast(kind === "image" ? "That picture is over 10 MB. Pick a smaller one." : "That file is over 60 MB. Pick a smaller one.", "error"); return; }
    const media = kind === "loop" ? "video" : kind === "image" ? "image" : null;
    if (media) { const blocked = await uploadBlocked(media); if (blocked) { toast(blocked, "error"); return; } }
    const path = `${uid}/${crypto.randomUUID()}.${ext}`;
    setProgress((p) => ({ ...p, [kind]: 0 }));
    const err = await uploadWithProgress(file, path, (pct) => setProgress((p) => ({ ...p, [kind]: pct })));
    setProgress((p) => ({ ...p, [kind]: undefined }));
    if (err) { toast(err, "error"); return; }
    fresh.current.add(path);
    if (media) { const c = await checkUploaded("cafe-media", path, media, file); if (c.message) toast(c.message, c.state === "unsafe" ? "error" : undefined); }
    const next = { path, preview: URL.createObjectURL(file), name: file.name };
    if (kind === "loop") { discard(loop?.path); setLoop(next); } else if (kind === "image") { discard(image?.path); setImage(next); } else { discard(track?.path); setTrack(next); }
  };

  const finishCover = async ({ blob, doc }: { blob: Blob; doc: CoverDoc }) => {
    const blocked = await uploadBlocked("image");
    if (blocked) { toast(blocked, "error"); return; }
    const path = `${uid}/${crypto.randomUUID()}.jpg`;
    setProgress((p) => ({ ...p, cover: 0 }));
    const err = await uploadWithProgress(new File([blob], "cover.jpg", { type: "image/jpeg" }), path, (pct) => setProgress((p) => ({ ...p, cover: pct })));
    setProgress((p) => ({ ...p, cover: undefined }));
    if (err) { toast(err, "error"); return; }
    fresh.current.add(path);
    const cc = await checkUploaded("cafe-media", path, "image");
    discard(cover?.path);
    setCover({ path, preview: URL.createObjectURL(blob), doc });
    setCoverTouched(true); setCoverOpen(false);
    toast(cc.message ?? "Cover ready. It is saved with the room.", cc.state === "unsafe" ? "error" : undefined);
  };
  const removeCover = () => { discard(cover?.path); setCover(null); setCoverTouched(true); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loopKind === "upload" && !loop) { toast("Upload a video, or pick another background.", "error"); return; }
    if (loopKind === "image" && !image) { toast("Upload a picture, or pick another background.", "error"); return; }
    if (musicKind === "upload" && !track) { toast("Upload a track, or choose a different music option.", "error"); return; }
    if (musicKind === "link" && !embed) { toast("Paste a Spotify, YouTube, Apple Music or SoundCloud link.", "error"); return; }
    setBusy(true);
    const input = {
      name, description, loop_kind: loopKind, loop_preset: loopKind === "preset" ? preset : null, loop_path: loopKind === "upload" ? loop!.path : loopKind === "image" ? image!.path : null,
      bg_color: loopKind === "color" ? bgColor : null,
      music_kind: musicKind, music_url: musicKind === "link" ? musicUrl.trim() : null, music_path: musicKind === "upload" ? track!.path : null,
      focus_minutes: focus, break_minutes: brk, listing,
      ...(coverTouched ? { cover_path: cover?.path ?? null, cover_doc: cover?.doc ?? null } : {}),
    };
    const res = initial ? await updateUserCafe(initial.id, input) : await createUserCafe(input);
    if ("error" in res) { setBusy(false); toast(res.error, "error"); return; }
    // Anything uploaded but not chosen is dropped.
    if (loopKind !== "upload") discard(loop?.path);
    if (loopKind !== "image") discard(image?.path);
    if (musicKind !== "upload") discard(track?.path);
    fresh.current.clear();
    toast(initial ? "Room updated." : "Your room is ready.");
    router.push(`/discover/c/${res.id}`);
  };

  const uploading = progress.cover !== undefined || progress.loop !== undefined || progress.image !== undefined || progress.track !== undefined;

  return (
    <form onSubmit={save} className="host-form" noValidate>
      <section className="card host-sec" aria-labelledby={`${uidFor}-basics`}>
        <h2 id={`${uidFor}-basics`} className="dc-h2">The basics</h2>
        <div className="field">
          <label className="field-label" htmlFor="host-name">Room name</label>
          <input id="host-name" className="input" value={name} maxLength={60} required onChange={(e) => setName(e.target.value)} placeholder="Quiet revision hour" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="host-desc">Short description <span className="field-hint" style={{ display: "inline" }}>(optional)</span></label>
          <textarea id="host-desc" className="input" rows={2} maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who is it for, and what are we working on?" />
          <div className="field-hint">{description.length}/200</div>
        </div>
      </section>

      <section className="card host-sec" aria-labelledby={`${uidFor}-loop`}>
        <h2 id={`${uidFor}-loop`} className="dc-h2">Background</h2>
        <div className="host-seg" role="radiogroup" aria-label="Background type">
          {KINDS.map(({ k, label }) => (
            <label key={k} className={loopKind === k ? "on" : ""}>
              <input type="radio" name="loop-kind" className="sr-only" checked={loopKind === k} onChange={() => setLoopKind(k)} />
              {label}
            </label>
          ))}
        </div>

        {loopKind === "preset" && (
          <div className="host-presets" role="radiogroup" aria-label="Preset loops">
            {PRESETS.map((p) => (
              <label key={p.id} className={`host-preset${preset === p.id ? " on" : ""}`}>
                <input type="radio" name="loop-preset" className="sr-only" checked={preset === p.id} onChange={() => setPreset(p.id)} />
                <span className="host-thumb">{stillOnly ? <img src={POSTER[p.id]} alt="" loading="lazy" /> : <video src={LOOP_SRC[p.id]} poster={POSTER[p.id]} muted loop playsInline autoPlay preload="metadata" aria-hidden="true" tabIndex={-1} />}</span>
                <span className="host-preset-name">{preset === p.id && <Check size={14} aria-hidden="true" />} {p.label}</span>
              </label>
            ))}
          </div>
        )}

        {loopKind === "upload" && (
          <div className="host-upload">
            <label className="btn" htmlFor="host-loop-file" style={{ cursor: "pointer" }}>
              <Upload size={15} aria-hidden="true" /> {loop ? "Replace video" : "Choose a video"}
            </label>
            <input id="host-loop-file" type="file" className="sr-only" accept="video/mp4,video/webm" disabled={progress.loop !== undefined}
              onChange={(e) => { void pick(e.target.files?.[0], "loop"); e.target.value = ""; }} aria-describedby="host-loop-hint" />
            <p id="host-loop-hint" className="field-hint">mp4 or webm, up to 60 MB. A short seamless loop works best. Use only video you made or have the right to share.</p>
            {progress.loop !== undefined && <Progress label="Uploading video" pct={progress.loop} />}
            {loop && progress.loop === undefined && (
              <figure className="host-preview">
                <video src={loop.preview} muted loop playsInline controls preload="metadata" aria-label={`Preview of ${loop.name}`} />
                <figcaption className="field-hint truncate">{loop.name}</figcaption>
              </figure>
            )}
          </div>
        )}

        {loopKind === "image" && (
          <div className="host-upload">
            <label className="btn" htmlFor="host-image-file" style={{ cursor: "pointer" }}>
              <ImageIcon size={15} aria-hidden="true" /> {image ? "Replace picture" : "Choose a picture"}
            </label>
            <input id="host-image-file" type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" disabled={progress.image !== undefined}
              onChange={(e) => { void pick(e.target.files?.[0], "image"); e.target.value = ""; }} aria-describedby="host-image-hint" />
            <p id="host-image-hint" className="field-hint">JPG, PNG or WebP, up to 10 MB. It fills the room, so a wide picture works best. Logia dims it so the timer stays readable. Use only pictures you made or have the right to share.</p>
            {progress.image !== undefined && <Progress label="Uploading picture" pct={progress.image} />}
            {image && progress.image === undefined && (
              <figure className="host-preview">
                {/* eslint-disable-next-line @next/next/no-img-element -- local or signed preview */}
                <img src={image.preview} alt={`Preview of ${image.name}`} className="host-img" />
                <figcaption className="field-hint truncate">{image.name}</figcaption>
              </figure>
            )}
          </div>
        )}

        {loopKind === "color" && (
          <div className="host-upload">
            <div className="host-swatches" role="radiogroup" aria-label="Background colour">
              {BG_SWATCHES.map((c) => {
                const on = bgColor.toLowerCase() === c.hex;
                return (
                  <label key={c.hex} className={`host-swatch${on ? " on" : ""}`} style={{ background: c.hex }}>
                    <input type="radio" name="bg-color" className="sr-only" checked={on} onChange={() => setBgColor(c.hex)} aria-label={c.name} />
                    {on && <Check size={18} aria-hidden="true" color="#fff" strokeWidth={3} />}
                  </label>
                );
              })}
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label" htmlFor="host-color-custom">Or choose any colour</label>
              <input id="host-color-custom" type="color" className="host-color-input" value={bgColor} onChange={(e) => setBgColor(e.target.value)} aria-describedby="host-color-hint" />
            </div>
            <p id="host-color-hint" className="field-hint">The room is filled with this colour. If it is light, Logia darkens it automatically so white text stays easy to read.</p>
            <div className="host-colorprev" style={{ background: bgColor }} role="img" aria-label={`Preview of the room with background colour ${bgColor}`}>
              <span style={{ background: `rgba(0,0,0,${colorVeil(bgColor)})` }}><b>25:00</b> Focus</span>
            </div>
          </div>
        )}
      </section>

      <section className="card host-sec" aria-labelledby={`${uidFor}-cover`}>
        <h2 id={`${uidFor}-cover`} className="dc-h2">Cover <span className="field-hint" style={{ display: "inline" }}>(optional)</span></h2>
        <p className="field-hint">A thumbnail for Discover, like a study-with-me video cover: a photo with handwritten words and doodles. You make it here, on your device. Without one, the playing loop is the thumbnail.</p>
        {cover && (
          <figure className="host-preview">
            {/* eslint-disable-next-line @next/next/no-img-element -- local or signed preview */}
            <img src={cover.preview} alt="Your cover" className="host-img" />
          </figure>
        )}
        {progress.cover !== undefined && <Progress label="Uploading cover" pct={progress.cover} />}
        <div className="ce-actions">
          <button type="button" className="btn" onClick={() => setCoverOpen(true)} disabled={progress.cover !== undefined}><Brush size={15} aria-hidden="true" /> {cover ? "Edit cover" : "Make a cover"}</button>
          {cover && <button type="button" className="btn btn-ghost" onClick={removeCover}>Remove cover</button>}
        </div>
        {coverOpen && (
          <CoverEditor scene={preset} focus={focus} brk={brk} initialDoc={cover?.doc ?? null} onClose={() => setCoverOpen(false)} onDone={(r) => void finishCover(r)} />
        )}
      </section>

      <section className="card host-sec" aria-labelledby={`${uidFor}-music`}>
        <h2 id={`${uidFor}-music`} className="dc-h2">Music</h2>
        <div className="host-seg" role="radiogroup" aria-label="Music source">
          {([["none", "None"], ["link", "Paste a link"], ["upload", "Upload a track"]] as const).map(([k, l]) => (
            <label key={k} className={musicKind === k ? "on" : ""}>
              <input type="radio" name="music-kind" className="sr-only" checked={musicKind === k} onChange={() => setMusicKind(k)} />
              {l}
            </label>
          ))}
        </div>

        {musicKind === "none" && <p className="field-hint"><VolumeX size={13} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> No music. Visitors can still turn on soft ambient sound in presets.</p>}

        {musicKind === "link" && (
          <div className="field">
            <label className="field-label" htmlFor="host-music-url">Spotify, YouTube, Apple Music or SoundCloud link</label>
            <input id="host-music-url" className="input" type="url" inputMode="url" value={musicUrl} onChange={(e) => setMusicUrl(e.target.value)}
              placeholder="https://open.spotify.com/playlist/…" aria-describedby="host-music-hint" aria-invalid={!!musicUrl.trim() && !embed} />
            <div id="host-music-hint" className="field-hint" aria-live="polite">
              {!musicUrl.trim() ? "People tap a button in the room to open the official player." : embed ? `${embed.label} link recognised.` : "That is not a supported link."}
            </div>
            {embed && (
              <iframe className="host-embed" title={`${embed.label} preview`} src={embed.src} height={embed.height} loading="lazy"
                allow="encrypted-media; clipboard-write; fullscreen" referrerPolicy="strict-origin-when-cross-origin" />
            )}
          </div>
        )}

        {musicKind === "upload" && (
          <div className="host-upload">
            <label className="btn" htmlFor="host-track-file" style={{ cursor: "pointer" }}>
              <Music size={15} aria-hidden="true" /> {track ? "Replace track" : "Choose a track"}
            </label>
            <input id="host-track-file" type="file" className="sr-only" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,audio/wav" disabled={progress.track !== undefined}
              onChange={(e) => { void pick(e.target.files?.[0], "track"); e.target.value = ""; }} aria-describedby="host-track-hint" />
            <p id="host-track-hint" className="field-hint">mp3, m4a, ogg or wav, up to 60 MB. Use only music you made or have permission to share. It loops quietly and visitors tap play themselves.</p>
            {progress.track !== undefined && <Progress label="Uploading track" pct={progress.track} />}
            {track && progress.track === undefined && (
              <figure className="host-preview">
                <audio src={track.preview} controls preload="metadata" aria-label={`Preview of ${track.name}`} />
                <figcaption className="field-hint truncate">{track.name}</figcaption>
              </figure>
            )}
          </div>
        )}
      </section>

      <section className="card host-sec" aria-labelledby={`${uidFor}-len`}>
        <h2 id={`${uidFor}-len`} className="dc-h2">Pomodoro lengths</h2>
        <div className="host-seg" role="radiogroup" aria-label="Focus and break lengths">
          {LENGTHS.map((l) => (
            <label key={l.f} className={!custom && focus === l.f && brk === l.b ? "on" : ""}>
              <input type="radio" name="len" className="sr-only" checked={!custom && focus === l.f && brk === l.b} onChange={() => { setCustom(false); setFocus(l.f); setBrk(l.b); }} />
              {l.f} / {l.b}
            </label>
          ))}
          <label className={custom ? "on" : ""}>
            <input type="radio" name="len" className="sr-only" checked={custom} onChange={() => setCustom(true)} />
            Custom
          </label>
        </div>
        {custom && (
          <div className="host-custom">
            <div className="field">
              <label className="field-label" htmlFor="host-focus">Focus (minutes)</label>
              <input id="host-focus" className="input" type="number" min={5} max={120} value={focus} onChange={(e) => setFocus(Number(e.target.value))} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="host-break">Break (minutes)</label>
              <input id="host-break" className="input" type="number" min={1} max={60} value={brk} onChange={(e) => setBrk(Number(e.target.value))} />
            </div>
          </div>
        )}
        <p className="field-hint">Focus time is quiet. Chat opens for everyone during the break.</p>
      </section>

      <section className="card host-sec" aria-labelledby={`${uidFor}-vis`}>
        <h2 id={`${uidFor}-vis`} className="dc-h2">Who can find it</h2>
        <div className="host-vis" role="radiogroup" aria-label="Visibility">
          <label className={listing === "unlisted" ? "on" : ""}>
            <input type="radio" name="vis" className="sr-only" checked={listing === "unlisted"} onChange={() => setListing("unlisted")} />
            <Link2 size={18} aria-hidden="true" />
            <span><b>Only people with the link</b><small>Share it with friends or your class. It will not appear on Discover.</small></span>
          </label>
          <label className={listing === "pending" ? "on" : ""}>
            <input type="radio" name="vis" className="sr-only" checked={listing === "pending"} onChange={() => setListing("pending")} />
            <Clapperboard size={18} aria-hidden="true" />
            <span><b>Ask to list on Discover</b><small>For everyone&apos;s safety, an admin reviews uploaded videos, pictures and music before a room is listed publicly. Until then it works by link.</small></span>
          </label>
        </div>
      </section>

      <div className="host-actions">
        <Link href="/discover?tab=rooms" className="btn btn-ghost"><X size={15} aria-hidden="true" /> Cancel</Link>
        <button type="submit" className="btn btn-primary" disabled={busy || uploading || !name.trim()}>
          {busy ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Check size={15} aria-hidden="true" />} {initial ? "Save changes" : "Create room"}
        </button>
      </div>
    </form>
  );
}

function Progress({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="host-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <span style={{ width: `${pct}%` }} /><em>{label} {pct}%</em>
    </div>
  );
}
