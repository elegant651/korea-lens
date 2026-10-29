import { describe, expect, it } from "vitest";
import {
  explainRequestSchema,
  explanationSchema,
  segmentRequestSchema,
  segmentResponseSchema,
  SUPPORTED_LANGUAGES,
} from "@/lib/validation/schemas";
import { extractJson } from "@/lib/meta/muse-spark";

describe("segmentRequestSchema", () => {
  const valid = {
    imageBase64: "aGVsbG8=",
    mimeType: "image/jpeg",
    imageWidth: 640,
    imageHeight: 480,
    prompt: "snack package",
  } as const;

  it("accepts a valid request with a concept prompt", () => {
    expect(segmentRequestSchema.parse(valid).prompt).toBe("snack package");
  });

  it("rejects bad mime, dimensions, oversized images, and bad prompts", () => {
    expect(() => segmentRequestSchema.parse({ ...valid, mimeType: "image/gif" })).toThrow();
    expect(() => segmentRequestSchema.parse({ ...valid, prompt: "" })).toThrow();
    expect(() => segmentRequestSchema.parse({ ...valid, prompt: undefined })).toThrow();
    expect(() => segmentRequestSchema.parse({ ...valid, imageWidth: 0 })).toThrow();
    expect(() =>
      segmentRequestSchema.parse({ ...valid, imageBase64: "x".repeat(14_000_001) }),
    ).toThrow();
    expect(() =>
      segmentRequestSchema.parse({ ...valid, prompt: "x".repeat(101) }),
    ).toThrow();
    expect(() => segmentRequestSchema.parse({ ...valid, imageBase64: "" })).toThrow();
  });
});

describe("segmentResponseSchema", () => {
  it("accepts a normalized result", () => {
    const parsed = segmentResponseSchema.parse({
      segments: [
        {
          id: "seg-0",
          label: "sign",
          score: 0.5,
          bbox: { x: 1, y: 2, width: 10, height: 20 },
          polygon: [{ x: 1, y: 2 }],
          mask: null,
        },
      ],
      imageWidth: 640,
      imageHeight: 480,
      prompt: null,
      live: true,
    });
    expect(parsed.segments).toHaveLength(1);
  });
});

describe("explainRequestSchema", () => {
  it("defaults language to English and enforces lengths", () => {
    const parsed = explainRequestSchema.parse({
      cropBase64: "aGVsbG8=",
      mimeType: "image/png",
      question: "What is this?",
    });
    expect(parsed.language).toBe("English");
    expect(() =>
      explainRequestSchema.parse({
        cropBase64: "aGVsbG8=",
        mimeType: "image/png",
        question: "",
      }),
    ).toThrow();
    expect(() =>
      explainRequestSchema.parse({
        cropBase64: "aGVsbG8=",
        mimeType: "image/png",
        question: "x".repeat(501),
      }),
    ).toThrow();
    expect(SUPPORTED_LANGUAGES).toContain("English");
  });
});

describe("explanationSchema", () => {
  it("accepts the proposal's structured response shape", () => {
    const parsed = explanationSchema.parse({
      likelyName: "Shrimp crackers",
      shortDescription: "A puffed snack.",
      travelContext: "Found in convenience stores.",
      koreanPhrase: "새우깡 주세요",
      uncertainties: ["Brand not verified."],
    });
    expect(parsed.koreanPhrase).toContain("새우깡");
  });

  it("rejects missing or mistyped fields", () => {
    expect(() => explanationSchema.parse({})).toThrow();
    expect(() =>
      explanationSchema.parse({
        likelyName: "x",
        shortDescription: "y",
        travelContext: "z",
        koreanPhrase: null,
        uncertainties: "not-an-array",
      }),
    ).toThrow();
  });
});

describe("extractJson", () => {
  it("parses fenced and embedded JSON", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('prefix {"a":2} suffix')).toEqual({ a: 2 });
    expect(extractJson("no json here")).toBe("no json here");
  });
});
