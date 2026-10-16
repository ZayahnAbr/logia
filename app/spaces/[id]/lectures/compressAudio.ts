"use client";

// Compress audio to 16kHz mono MP3 in-browser using lamejs
export async function compressAudioFile(file: File): Promise<File> {
  const arrayBuffer = await file.arrayBuffer();
  // Older iPhones (Safari before 14.5) only have webkitAudioContext and reject a custom sample rate.
  // Fall back to the device rate: the code below resamples to 16kHz itself.
  const Ctx: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error("This browser can't prepare recordings. Try Safari or Chrome.");
  let audioContext: AudioContext;
  try { audioContext = new Ctx({ sampleRate: 16000 }); } catch { audioContext = new Ctx(); }
  // Video files work too: the browser decodes the sound track and the picture is discarded,
  // so only the small audio file is ever uploaded.
  let audioBuffer: AudioBuffer;
  try {
    // Safari's decodeAudioData is callback-based on older versions; wrap it so both forms work.
    audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
      const p = audioContext.decodeAudioData(arrayBuffer, resolve, reject);
      if (p && typeof p.then === "function") p.then(resolve, reject);
    });
  } catch {
    const isVideo = file.type.startsWith("video/") || /\.(mp4|mov|mkv|avi|webm|m4v)$/i.test(file.name);
    throw new Error(isVideo
      ? "This browser could not read the sound in that video. Try an MP4 or WebM recording, or save the audio on its own first."
      : "That file could not be read as a recording. Try an MP3, M4A, WAV or MP4 file.");
  }
  void audioContext.close().catch(() => {}); // iPhones allow only a few open audio contexts
  if (!audioBuffer.length) throw new Error("That recording has no sound in it.");

  // mix down to mono at 16kHz
  const monoData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;

  // resample to 16kHz if needed
  let samples = monoData;
  if (sampleRate !== 16000) {
    const ratio = sampleRate / 16000;
    const newLength = Math.round(monoData.length / ratio);
    const resampled = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      resampled[i] = monoData[Math.round(i * ratio)] ?? 0;
    }
    samples = resampled;
  }

  // convert float32 to int16
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  // encode with lamejs
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const encoder = new Mp3Encoder(1, 16000, 32); // mono, 16kHz, 32kbps: clear for speech, ~100 min fits the 25 MB limit
  const BLOCK = 1152;
  const mp3Parts: Uint8Array[] = [];

  for (let i = 0; i < int16.length; i += BLOCK) {
    const chunk = int16.subarray(i, i + BLOCK);
    const encoded = encoder.encodeBuffer(chunk);
    if (encoded.length > 0) mp3Parts.push(new Uint8Array(encoded));
  }
  const flushed = encoder.flush();
  if (flushed.length > 0) mp3Parts.push(new Uint8Array(flushed));

  const blob = new Blob(mp3Parts as BlobPart[], { type: "audio/mp3" });
  const name = file.name.replace(/\.[^.]+$/, "") + "_compressed.mp3";
  return new File([blob], name, { type: "audio/mp3" });
}
