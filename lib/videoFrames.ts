// Browser only. Takes evenly spaced frames from a video file for the safety check (about 512 px JPEGs).
export async function extractFrames(file: Blob, count = 7, maxSide = 512): Promise<string[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true; video.preload = "auto"; video.playsInline = true; video.src = url;
  const once = (ev: string) => new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error("timeout")), 8000);
    video.addEventListener(ev, () => { window.clearTimeout(t); resolve(); }, { once: true });
    video.addEventListener("error", () => { window.clearTimeout(t); reject(new Error("video")); }, { once: true });
  });
  try {
    await once("loadeddata");
    const d = video.duration;
    if (!Number.isFinite(d) || d <= 0) return [];
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth || maxSide, video.videoHeight || maxSide));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((video.videoWidth || maxSide) * scale));
    canvas.height = Math.max(1, Math.round((video.videoHeight || maxSide) * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const seeked = once("seeked");
      video.currentTime = Math.min(d - 0.05, ((i + 0.5) / count) * d);
      await seeked;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      out.push(canvas.toDataURL("image/jpeg", 0.7));
    }
    return out;
  } catch {
    return [];
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src"); video.load();
  }
}
