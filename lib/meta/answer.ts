import {
  buildAuthHeaders,
  extractOutputText,
  getVisionConfig,
  metaPostJson,
  MetaProviderError,
} from "./client";

export interface AnswerQuestionInput {
  objectName: string;
  objectContext?: string;
  question: string;
  language: string;
}

export interface AnswerSource {
  title: string;
  url: string;
}

export interface AnswerQuestionOutput {
  answer: string;
  sources: AnswerSource[];
  /** True when the model performed a live web search for this answer. */
  searched: boolean;
}

const ANSWER_TIMEOUT_MS = 60_000;
const MAX_SOURCES = 5;

const ANSWER_INSTRUCTION = `You are KoreaLens, a visual assistant for international visitors in South Korea.
The user photographed an object and your vision model already identified it; the name and context below are what was seen.
Answer the follow-up question about that object using your knowledge and, when the question needs current or specific facts (popularity, taste, price, ingredients, availability), the live web search results provided to you.
Answer in the requested language using concise, practical wording.
Do not narrate your search process or thinking; start directly with the answer.
Distinguish well-established facts from uncertain claims.
Do not invent prices, opening hours, or safety claims.
For food allergies or dietary restrictions, never claim a product is safe. Recommend checking the package or asking staff.`;

export interface AnswerRequestArgs {
  model: string;
  objectName: string;
  objectContext?: string;
  question: string;
  language: string;
}

/**
 * Build the documented text-only Responses API request with the web_search
 * tool and raw search results included.
 * See https://dev.meta.ai/docs/search-grounding
 */
export function buildAnswerRequest(args: AnswerRequestArgs): Record<string, unknown> {
  const text = [
    ANSWER_INSTRUCTION,
    "",
    `Identified object: ${args.objectName}`,
    args.objectContext ? `What was seen: ${args.objectContext}` : null,
    `Question: ${args.question}`,
    `Respond in this language: ${args.language}.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return {
    model: args.model,
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    ],
    tools: [{ type: "web_search" }],
    include: ["web_search_call.results"],
  };
}

/**
 * Answer a follow-up question about an already-identified object using the
 * object name (not the image), grounded in live web search when needed.
 */
export async function answerQuestion(input: AnswerQuestionInput): Promise<AnswerQuestionOutput> {
  const config = getVisionConfig();

  const raw = await metaPostJson(config.apiUrl, {
    timeoutMs: ANSWER_TIMEOUT_MS,
    headers: buildAuthHeaders(config.apiKey),
    body: JSON.stringify(
      buildAnswerRequest({
        model: config.model,
        objectName: input.objectName,
        objectContext: input.objectContext,
        question: input.question,
        language: input.language,
      }),
    ),
  });

  const answer = extractOutputText(raw);
  if (!answer) {
    throw new MetaProviderError("Model returned an empty answer", 502, true);
  }
  const { sources, searched } = extractSources(raw);
  return { answer, sources, searched };
}

/**
 * Collect cited sources from url_citation annotations, falling back to raw
 * web_search_call results. Deduplicated by URL, capped at MAX_SOURCES.
 * Returns searched=true when a completed web_search_call is present.
 */
export function extractSources(raw: unknown): { sources: AnswerSource[]; searched: boolean } {
  const sources: AnswerSource[] = [];
  const seen = new Set<string>();
  let searched = false;
  if (typeof raw !== "object" || raw === null) return { sources, searched };
  const output = (raw as Record<string, unknown>)["output"];
  if (!Array.isArray(output)) return { sources, searched };

  const push = (title: unknown, url: unknown) => {
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    if (sources.length < MAX_SOURCES) {
      sources.push({
        title: typeof title === "string" && title.length > 0 ? title.slice(0, 200) : url,
        url,
      });
    }
  };

  const fallback: Array<{ title: unknown; url: unknown }> = [];
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    if (obj["type"] === "web_search_call") {
      if (obj["status"] === "completed") searched = true;
      const results = obj["results"];
      if (Array.isArray(results)) {
        for (const r of results) {
          if (typeof r === "object" && r !== null) {
            const rec = r as Record<string, unknown>;
            fallback.push({ title: rec["title"], url: rec["url"] });
          }
        }
      }
      continue;
    }
    const content = obj["content"];
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part !== "object" || part === null) continue;
      const annotations = (part as Record<string, unknown>)["annotations"];
      if (!Array.isArray(annotations)) continue;
      for (const a of annotations) {
        if (typeof a !== "object" || a === null) continue;
        const ann = a as Record<string, unknown>;
        if (ann["type"] === "url_citation") push(ann["title"], ann["url"]);
      }
    }
  }
  if (sources.length === 0) {
    for (const f of fallback) push(f.title, f.url);
  }
  return { sources, searched };
}
