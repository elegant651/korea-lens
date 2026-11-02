"use client";

/** Max voice follow-up recording length (well under the API's 10-minute limit). */
export const MAX_RECORD_MS = 30_000;
/** Transcribe API sample rate: mono PCM at 16 kHz. */
const TARGET_SAMPLE_RATE = 16_000;

export function isRecordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof AudioContext !== "undefined" &&
    typeof OfflineAudioContext !== "undefined"
  );
}

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export interface RecordingHandle {
  /** Stop recording and resolve with the recorded audio blob. */
  stop: () => Promise<Blob>;
  /** Abort without producing audio. */
  cancel: () => void;
}

/**
 * Record from the microphone until stop() or maxMs (auto-stop fires
 * onAutoStop). Resolves the handle once recording has started; rejects when
 * permission is denied or recording cannot start.
 */
export async function startRecording(
  maxMs: number = MAX_RECORD_MS,
  onAutoStop?: () => void,
): Promise<RecordingHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickRecordingMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  const cleanup = () => {
    if (timer) clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
  };

  const result = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Recording failed in this browser."));
    };
    recorder.onstop = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (chunks.length === 0) {
        reject(new Error("No audio was captured. Please try again."));
        return;
      }
      resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    };
  });

  try {
    recorder.start();
  } catch {
    cleanup();
    throw new Error("Recording could not start in this browser.");
  }
  timer = setTimeout(() => {
    if (recorder.state !== "inactive") {
      onAutoStop?.();
      recorder.stop();
    }
  }, maxMs);

  return {
    stop: () => {
      if (recorder.state !== "inactive") recorder.stop();
      return result;
    },
    cancel: () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        // Already stopped.
      }
    },
  };
}

function pickRecordingMimeType(): string {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  for (const t of ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"]) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      // ignore
    }
  }
  return "";
}

/**
 * Convert any recorded blob into 16 kHz mono PCM WAV base64, the container
 * the Transcribe API requires. Throws when the audio cannot be decoded.
 */
export async function recordingToWavBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(buffer.slice(0));
    const length = Math.max(1, Math.floor(decoded.duration * TARGET_SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, length, TARGET_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    return wavBase64(encodeWavPcm16(samples, TARGET_SAMPLE_RATE));
  } catch {
    throw new Error("That recording could not be read. Please try again.");
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

/** Encode mono float samples as a RIFF/WAVE PCM16 buffer. Pure and testable. */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

function wavBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

const BCP47: Record<string, string> = {
  Korean: "ko",
  English: "en",
  Spanish: "es",
  French: "fr",
  German: "de",
  Japanese: "ja",
  "Chinese (Simplified)": "zh-CN",
  Vietnamese: "vi",
  Thai: "th",
  Indonesian: "id",
  Portuguese: "pt",
};

export function languageToBcp47(language: string): string {
  return BCP47[language] ?? "en";
}

/** Speak text with browser speech synthesis (no extra service). */
export function speakText(text: string, language: string): void {
  if (!isSpeechSupported()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const target = languageToBcp47(language);
  utterance.lang = target;
  const prefix = target.split("-")[0];
  const voice =
    synth
      .getVoices()
      .find((v) => v.lang === target || v.lang.startsWith(`${target}-`)) ??
    synth.getVoices().find((v) => v.lang === prefix || v.lang.startsWith(`${prefix}-`));
  if (voice) utterance.voice = voice;
  synth.speak(utterance);
}

export function stopSpeaking(): void {
  if (isSpeechSupported()) window.speechSynthesis.cancel();
}

export function isSpeaking(): boolean {
  return isSpeechSupported() && window.speechSynthesis.speaking;
}
