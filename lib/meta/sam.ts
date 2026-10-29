import {
  decodeMaskToRaster,
  parseImageStream,
  recordsOfKind,
  type ResponsesEvent,
} from "@meta-sam/parser";
import type { Point, Segment } from "@/lib/segmentation/types";
import { packBitmaskToBase64 } from "@/lib/segmentation/mask-decoder";
import {
  buildAuthHeaders,
  extractOutputText,
  getSamConfig,
  metaPostJson,
} from "./client";

export interface SegmentImageInput {
  imageBase64: string;
  mimeType: string;
  imageWidth: number;
  imageHeight: number;
  /** One short noun phrase, e.g. "snack package". Required by SAM 3.1. */
  concept: string;
}

export interface SegmentImageOutput {
  segments: Segment[];
  imageWidth: number;
  imageHeight: number;
  prompt: string | null;
}

const SAM_TIMEOUT_MS = 60_000;

export interface SamRequestArgs {
  model: string;
  concept: string;
  mimeType: string;
  imageBase64: string;
}

/**
 * Build the documented non-streaming Responses API request for SAM 3.1:
 * one concept noun phrase in input_text plus the image as a base64 data URL.
 * See https://dev.meta.ai/docs/sam/segmenting
 */
export function buildSamRequest(args: SamRequestArgs): Record<string, unknown> {
  return {
    model: args.model,
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: args.concept },
          { type: "input_image", image_url: `data:${args.mimeType};base64,${args.imageBase64}` },
        ],
      },
    ],
    metadata: { include_confidence: "true", mask_encoding: "one_bit" },
  };
}

/**
 * Segment matching objects via the Meta Model API (sam-3.1). Uses a
 * non-streaming request and parses the output text with the official
 * @meta-sam/parser grammar. Zero matches is a normal empty result.
 */
export async function segmentImage(input: SegmentImageInput): Promise<SegmentImageOutput> {
  const config = getSamConfig();
  const concept = input.concept.trim();

  const raw = await metaPostJson(config.apiUrl, {
    timeoutMs: SAM_TIMEOUT_MS,
    headers: buildAuthHeaders(config.apiKey),
    body: JSON.stringify(
      buildSamRequest({
        model: config.model,
        concept,
        mimeType: input.mimeType,
        imageBase64: input.imageBase64,
      }),
    ),
  });

  const outputText = extractOutputText(raw);
  const segments = await segmentsFromOutputText(
    outputText ?? "",
    concept,
    input.imageWidth,
    input.imageHeight,
  );
  return { segments, imageWidth: input.imageWidth, imageHeight: input.imageHeight, prompt: concept };
}

/**
 * Convert SAM 3.1 output text (<0f>id<|box;..|><|mask;..|>,...) into normalized
 * segments. Box x2/y2 are inclusive on the wire; masks are decoded with the
 * official decoder and re-encoded as compact bitmasks cropped to their box.
 */
export async function segmentsFromOutputText(
  outputText: string,
  concept: string,
  imageWidth: number,
  imageHeight: number,
): Promise<Segment[]> {
  if (outputText.trim().length === 0) return [];

  const result = await parseImageStream(eventsFor(outputText)).finalResult;
  if (result.outcome.status !== "completed") {
    return [];
  }

  const masksByObject = new Map(
    recordsOfKind(result.records, "mask").map((m) => [m.objectId, m] as const),
  );
  const segments: Segment[] = [];
  for (const box of recordsOfKind(result.records, "box")) {
    const x = clamp(Math.min(box.left, box.right), 0, imageWidth);
    const y = clamp(Math.min(box.top, box.bottom), 0, imageHeight);
    const right = clamp(Math.max(box.left, box.right), 0, imageWidth);
    const bottom = clamp(Math.max(box.top, box.bottom), 0, imageHeight);
    if (right - x < 1 || bottom - y < 1) continue;

    const bbox = { x, y, width: right - x, height: bottom - y };
    const score = typeof box.confidence === "number" ? clamp(box.confidence, 0, 1) : null;
    const maskRecord = masksByObject.get(box.objectId);

    let mask: Segment["mask"] = null;
    if (maskRecord) {
      try {
        const raster = decodeMaskToRaster(maskRecord.mask);
        mask = {
          width: maskRecord.mask.width,
          height: maskRecord.mask.height,
          encoding: "base64-bitmap",
          data: packBitmaskToBase64(raster, maskRecord.mask.width, maskRecord.mask.height),
          origin: { x, y },
        };
      } catch {
        mask = null;
      }
    }

    const polygon: Point[] | null =
      mask === null
        ? [
            { x, y },
            { x: x + bbox.width, y },
            { x: x + bbox.width, y: y + bbox.height },
            { x, y: y + bbox.height },
          ]
        : null;

    segments.push({ id: `sam-${box.objectId}`, label: concept, score, bbox, polygon, mask });
  }
  return segments;
}

/** Feed complete output text to the streaming parser as a single delta. */
async function* eventsFor(outputText: string): AsyncIterable<ResponsesEvent> {
  const lane = { item_id: "korea-lens-output", output_index: 0, content_index: 0 } as const;
  yield { type: "response.output_text.delta", ...lane, delta: outputText };
  yield { type: "response.output_text.done", ...lane, text: outputText };
  yield { type: "response.completed" };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Default concept and bounded fallback concepts (one noun phrase each). */
export const DEFAULT_CONCEPT = "snack package";
export const FALLBACK_PROMPTS = ["snack package", "drink bottle", "food item", "sign"] as const;

/** Max SAM attempts per image (initial + bounded retries). */
export const MAX_SEGMENT_ATTEMPTS = 4;
