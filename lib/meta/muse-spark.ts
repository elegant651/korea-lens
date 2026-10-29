import { explanationSchema, type Explanation } from "@/lib/validation/schemas";
import {
  buildAuthHeaders,
  extractOutputText,
  getVisionConfig,
  metaPostJson,
  MetaProviderError,
} from "./client";

export interface ExplainCropInput {
  cropBase64: string;
  mimeType: string;
  question: string;
  language: string;
  sceneContext?: string;
}

const VISION_TIMEOUT_MS = 60_000;

const SYSTEM_INSTRUCTION = `You are KoreaLens, a visual assistant for international visitors in South Korea.
Describe only what is reasonably supported by the supplied image.
Answer in the requested language using concise, practical wording.
Distinguish visible facts from uncertain inferences.
Do not invent product names, ingredients, prices, opening hours, or safety claims.
If the image does not provide enough evidence, say what cannot be confirmed.
For food allergies or dietary restrictions, never claim a product is safe based only on appearance. Recommend checking the package or asking staff.`;

/** JSON Schema for the structured explanation (Responses text.format). */
export const EXPLANATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    likelyName: { type: "string", description: "Short likely identity of the object" },
    shortDescription: { type: "string", description: "Concise grounded description" },
    travelContext: { type: "string", description: "Useful travel context for a visitor" },
    koreanPhrase: {
      type: ["string", "null"],
      description: "A useful Korean phrase for this situation, or null",
    },
    uncertainties: {
      type: "array",
      items: { type: "string" },
      description: "What cannot be confirmed from the image",
    },
  },
  required: ["likelyName", "shortDescription", "travelContext", "koreanPhrase", "uncertainties"],
} as const;

export interface VisionRequestArgs {
  model: string;
  instruction: string;
  question: string;
  language: string;
  sceneContext?: string;
  mimeType: string;
  cropBase64: string;
}

/**
 * Build the documented Responses API request for image understanding with
 * structured JSON output (text.format json_schema).
 * See https://dev.meta.ai/docs/image-understanding
 */
export function buildVisionRequest(args: VisionRequestArgs): Record<string, unknown> {
  const text = [
    args.instruction,
    "",
    `Question: ${args.question}`,
    `Respond in this language: ${args.language}.`,
    args.sceneContext ? `Scene context: ${args.sceneContext}.` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return {
    model: args.model,
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text },
          { type: "input_image", image_url: `data:${args.mimeType};base64,${args.cropBase64}` },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "KoreaLensExplanation",
        schema: EXPLANATION_JSON_SCHEMA,
      },
    },
  };
}

/**
 * Ask Muse Spark about the selected object crop. The response is
 * schema-constrained JSON; it is still validated with Zod, and invalid
 * output becomes a safe uncertain result instead of an error.
 */
export async function explainCrop(input: ExplainCropInput): Promise<Explanation> {
  const config = getVisionConfig();

  const raw = await metaPostJson(config.apiUrl, {
    timeoutMs: VISION_TIMEOUT_MS,
    headers: buildAuthHeaders(config.apiKey),
    body: JSON.stringify(
      buildVisionRequest({
        model: config.model,
        instruction: SYSTEM_INSTRUCTION,
        question: input.question,
        language: input.language,
        sceneContext: input.sceneContext,
        mimeType: input.mimeType,
        cropBase64: input.cropBase64,
      }),
    ),
  });

  const text = extractOutputText(raw);
  if (!text) {
    throw new MetaProviderError("Vision model returned an empty response", 502, true);
  }
  const parsed = explanationSchema.safeParse(extractJson(text));
  if (parsed.success) return parsed.data;

  return {
    likelyName: "Unidentified object",
    shortDescription: text.slice(0, 1500),
    travelContext: "",
    koreanPhrase: null,
    uncertainties: ["The model response could not be verified against the expected format."],
  };
}

/** Parse JSON from model text, tolerating fenced code blocks. Returns raw text on failure. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as unknown;
      } catch {
        return candidate;
      }
    }
    return candidate;
  }
}
