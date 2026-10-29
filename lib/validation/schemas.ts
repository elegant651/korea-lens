import { z } from "zod";

export const SUPPORTED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;

/** Max base64 payload accepted by the API routes (~10MB of binary). */
export const MAX_IMAGE_BASE64_CHARS = 14_000_000;
export const MAX_PROMPT_CHARS = 100;
export const MAX_QUESTION_CHARS = 500;
export const MAX_CONTEXT_CHARS = 500;

const base64Payload = z
  .string()
  .min(1, "image is required")
  .max(MAX_IMAGE_BASE64_CHARS, "image is too large (max ~10MB)")
  .refine((s) => /^[A-Za-z0-9+/=\s-]+$/.test(s), "image must be base64 or base64url");

export const segmentRequestSchema = z.object({
  /** Base64-encoded image bytes (no data-URL prefix). */
  imageBase64: base64Payload,
  mimeType: z.enum(SUPPORTED_IMAGE_MIMES),
  imageWidth: z.number().int().positive().max(20000),
  imageHeight: z.number().int().positive().max(20000),
  /** One concept noun phrase, e.g. "snack package". Required by SAM 3.1. */
  prompt: z.string().trim().min(1, "prompt is required").max(MAX_PROMPT_CHARS),
});

export type SegmentRequest = z.infer<typeof segmentRequestSchema>;

const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

export const segmentSchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().max(200).nullable(),
  score: z.number().min(0).max(1).nullable(),
  bbox: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  }),
  polygon: z.array(pointSchema).nullable(),
  mask: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      encoding: z.enum(["base64-bitmap", "base64-bytes", "base85-bitmap", "base85-bytes", "rle"]),
      data: z.string().min(1),
      origin: pointSchema.nullable(),
    })
    .nullable(),
});

export const segmentResponseSchema = z.object({
  segments: z.array(segmentSchema),
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  /** Prompt that produced this result (echo). */
  prompt: z.string().nullable(),
  /** True when masks came from the live SAM API; false for labeled samples. */
  live: z.boolean(),
});

export type SegmentResponse = z.infer<typeof segmentResponseSchema>;

export const SUPPORTED_LANGUAGES = [
  "English",
  "Spanish",
  "French",
  "German",
  "Japanese",
  "Chinese (Simplified)",
  "Vietnamese",
  "Thai",
  "Indonesian",
  "Portuguese",
] as const;

export const explainRequestSchema = z.object({
  /** Base64-encoded crop bytes (no data-URL prefix). */
  cropBase64: base64Payload,
  mimeType: z.enum(SUPPORTED_IMAGE_MIMES),
  question: z.string().trim().min(1, "question is required").max(MAX_QUESTION_CHARS),
  language: z.enum(SUPPORTED_LANGUAGES).default("English"),
  /** Optional non-sensitive scene context, e.g. "convenience-store shelf". */
  sceneContext: z.string().trim().max(MAX_CONTEXT_CHARS).optional(),
});

export type ExplainRequest = z.infer<typeof explainRequestSchema>;

export const explanationSchema = z.object({
  likelyName: z.string().min(1).max(300),
  shortDescription: z.string().min(1).max(2000),
  travelContext: z.string().max(2000),
  koreanPhrase: z.string().max(500).nullable(),
  uncertainties: z.array(z.string().max(500)).max(10),
});

export type Explanation = z.infer<typeof explanationSchema>;

export const explainResponseSchema = explanationSchema.extend({
  /** True when the answer came from the live vision model. */
  live: z.boolean(),
});

export type ExplainResponse = z.infer<typeof explainResponseSchema>;

export const apiErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
  retryable: z.boolean(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
