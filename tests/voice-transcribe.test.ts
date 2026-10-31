import { describe, expect, it } from "vitest";
import { encodeWavPcm16 } from "@/lib/client/audio";
import {
  buildTranscribeSettings,
  isWavContainer,
  mapLanguageToBias,
} from "@/lib/meta/transcribe";
import {
  transcribeRequestSchema,
  transcribeResponseSchema,
} from "@/lib/validation/schemas";

describe("buildTranscribeSettings", () => {
  it("builds the documented multipart request part", () => {
    expect(buildTranscribeSettings("muse-voice-transcribe-1.0", "English")).toEqual({
      model: "muse-voice-transcribe-1.0",
      audioEncoding: "WAV",
      mode: "PUSH_TO_TALK",
      languageBias: ["English"],
    });
  });
});

describe("mapLanguageToBias", () => {
  it("maps UI language names to bias names", () => {
    expect(mapLanguageToBias("English")).toBe("English");
    expect(mapLanguageToBias("Chinese (Simplified)")).toBe("Chinese");
  });
});

describe("isWavContainer", () => {
  it("accepts RIFF/WAVE magic and rejects everything else", () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    expect(isWavContainer(wav)).toBe(true);
    expect(isWavContainer(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(isWavContainer(new Uint8Array(12))).toBe(false);
  });
});

describe("transcribeRequestSchema", () => {
  it("accepts a WAV clip and defaults the language", () => {
    const parsed = transcribeRequestSchema.parse({
      audioBase64: "UklGRg==",
      mimeType: "audio/wav",
    });
    expect(parsed.language).toBe("English");
  });

  it("rejects non-WAV mime, empty audio, and oversized clips", () => {
    const base = { audioBase64: "UklGRg==", mimeType: "audio/wav" } as const;
    expect(() => transcribeRequestSchema.parse({ ...base, mimeType: "audio/webm" })).toThrow();
    expect(() => transcribeRequestSchema.parse({ ...base, audioBase64: "" })).toThrow();
    expect(() =>
      transcribeRequestSchema.parse({ ...base, audioBase64: "x".repeat(8_500_001) }),
    ).toThrow();
  });
});

describe("transcribeResponseSchema", () => {
  it("accepts the documented buffered response shape", () => {
    const parsed = transcribeResponseSchema.parse({
      transcript: "What is this?",
      audioDurationMs: 1200,
      live: true,
    });
    expect(parsed.transcript).toBe("What is this?");
  });
});

describe("encodeWavPcm16", () => {
  it("writes a valid RIFF/WAVE header with the samples", () => {
    const buffer = encodeWavPcm16(new Float32Array([0, 0.5, -0.5, 1]), 16000);
    const bytes = new Uint8Array(buffer);
    expect(isWavContainer(bytes)).toBe(true);
    expect(buffer.byteLength).toBe(44 + 8);
    const view = new DataView(buffer);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint16(34, true)).toBe(16); // PCM16
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(Math.floor(0.5 * 0x7fff));
  });
});
