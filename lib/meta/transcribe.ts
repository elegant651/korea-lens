import { z } from "zod";
import {
  buildAuthHeaders,
  getApiKey,
  getBaseUrl,
  metaPostForm,
  MetaProviderError,
} from "./client";

export const DEFAULT_TRANSCRIBE_MODEL = "muse-voice-transcribe-1.0";

/** Local audio validation failed (bad base64 or not a WAV container). */
export class InvalidAudioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAudioError";
  }
}

export interface TranscribeAudioInput {
  audioBase64: string;
  language: string;
}

export interface TranscribeAudioOutput {
  transcript: string;
  audioDurationMs: number;
}

const TRANSCRIBE_TIMEOUT_MS = 60_000;

function readEnv(name: string): string | null {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : null;
}

export interface TranscribeSettings {
  model: string;
  audioEncoding: "WAV";
  mode: "PUSH_TO_TALK";
  languageBias: string[];
}

/**
 * Build the `request` part of the multipart transcribe body.
 * See https://dev.meta.ai/docs/api-reference/voice/transcribe
 */
export function buildTranscribeSettings(model: string, language: string): TranscribeSettings {
  return {
    model,
    audioEncoding: "WAV",
    mode: "PUSH_TO_TALK",
    languageBias: [mapLanguageToBias(language)],
  };
}

/** Map our UI language names to transcription bias names. */
export function mapLanguageToBias(language: string): string {
  if (language === "Chinese (Simplified)") return "Chinese";
  return language;
}

/** Check the RIFF/WAVE container magic. The API rejects anything else. */
export function isWavContainer(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  return (
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x41 && // A
    bytes[10] === 0x56 && // V
    bytes[11] === 0x45 // E
  );
}

const transcribeApiResponseSchema = z.object({
  transcript: z.string(),
  audioDurationMs: z.number().int().nonnegative(),
});

/**
 * Transcribe one complete WAV recording via Muse Voice Transcribe
 * (POST /asr/transcribe, multipart, buffered JSON response).
 */
export async function transcribeAudio(input: TranscribeAudioInput): Promise<TranscribeAudioOutput> {
  const apiKey = getApiKey();
  const model = readEnv("META_TRANSCRIBE_MODEL_ID") ?? DEFAULT_TRANSCRIBE_MODEL;

  let bytes: Buffer;
  try {
    bytes = Buffer.from(input.audioBase64, "base64");
  } catch {
    throw new InvalidAudioError("Audio data is not valid base64");
  }
  if (bytes.length === 0 || !isWavContainer(bytes)) {
    throw new InvalidAudioError("Audio must be a WAV (RIFF/WAVE) recording");
  }

  const form = new FormData();
  form.append(
    "request",
    new Blob([JSON.stringify(buildTranscribeSettings(model, input.language))], {
      type: "application/json",
    }),
  );
  form.append(
    "audio",
    new Blob([new Uint8Array(bytes)], { type: "audio/wav" }),
    "recording.wav",
  );

  const raw = await metaPostForm(`${getBaseUrl()}/asr/transcribe`, {
    timeoutMs: TRANSCRIBE_TIMEOUT_MS,
    headers: { ...buildAuthHeaders(apiKey), accept: "application/json" },
    form,
  });

  const parsed = transcribeApiResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new MetaProviderError("Transcribe API returned an unexpected response", 502, true);
  }
  return { transcript: parsed.data.transcript, audioDurationMs: parsed.data.audioDurationMs };
}
