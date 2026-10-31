import { describe, expect, it } from "vitest";
import { buildAnswerRequest, extractSources } from "@/lib/meta/answer";
import { answerRequestSchema, answerResponseSchema } from "@/lib/validation/schemas";

describe("buildAnswerRequest", () => {
  it("builds a text-only request with the web_search tool", () => {
    const req = buildAnswerRequest({
      model: "muse-spark-1.3",
      objectName: "Shin Ramyun",
      objectContext: "A red instant noodle package.",
      question: "Is it spicy?",
      language: "English",
    });
    expect(req.model).toBe("muse-spark-1.3");
    expect(req.tools).toEqual([{ type: "web_search" }]);
    expect(req.include).toEqual(["web_search_call.results"]);
    const content = (
      req.input as Array<{ content: Array<{ type: string; text?: string }> }>
    )[0].content;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("input_text");
    expect(content[0].text).toContain("Shin Ramyun");
    expect(content[0].text).toContain("Is it spicy?");
    expect(JSON.stringify(req)).not.toContain("input_image");
  });
});

describe("extractSources", () => {
  const searchItem = {
    id: "ws_1",
    type: "web_search_call",
    status: "completed",
    results: [
      { type: "text_result", title: "Raw result", url: "https://example.com/raw", snippet: "…" },
    ],
  };

  it("reads url_citation annotations and flags searched", () => {
    const raw = {
      output: [
        searchItem,
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Yes, it is spicy.",
              annotations: [
                { type: "url_citation", url: "https://example.com/a", title: "Spice guide" },
                { type: "url_citation", url: "https://example.com/a", title: "Spice guide" },
                { type: "other", url: "https://example.com/ignored" },
              ],
            },
          ],
        },
      ],
    };
    const { sources, searched } = extractSources(raw);
    expect(searched).toBe(true);
    // Citations win over raw results; duplicates collapse.
    expect(sources).toEqual([{ title: "Spice guide", url: "https://example.com/a" }]);
  });

  it("falls back to raw search results when no citations exist", () => {
    const raw = {
      output: [searchItem, { type: "message", content: [{ type: "output_text", text: "hi" }] }],
    };
    const { sources, searched } = extractSources(raw);
    expect(searched).toBe(true);
    expect(sources).toEqual([{ title: "Raw result", url: "https://example.com/raw" }]);
  });

  it("returns empty sources when nothing was searched", () => {
    expect(extractSources({ output: [] })).toEqual({ sources: [], searched: false });
    expect(extractSources(null)).toEqual({ sources: [], searched: false });
  });

  it("skips non-http URLs and caps at five sources", () => {
    const annotations = Array.from({ length: 7 }, (_, i) => ({
      type: "url_citation",
      url: `https://example.com/${i}`,
      title: `t${i}`,
    }));
    annotations.push({ type: "url_citation", url: "javascript:alert(1)", title: "x" });
    const raw = {
      output: [{ type: "message", content: [{ type: "output_text", text: "hi", annotations }] }],
    };
    const { sources } = extractSources(raw);
    expect(sources).toHaveLength(5);
    expect(sources.every((s) => s.url.startsWith("https://"))).toBe(true);
  });
});

describe("answerRequestSchema", () => {
  it("accepts a name-based question and defaults the language", () => {
    const parsed = answerRequestSchema.parse({ objectName: "Shin Ramyun", question: "Is it sweet?" });
    expect(parsed.language).toBe("English");
  });

  it("rejects missing names and questions", () => {
    expect(() => answerRequestSchema.parse({ objectName: "", question: "x" })).toThrow();
    expect(() => answerRequestSchema.parse({ objectName: "x", question: "" })).toThrow();
  });
});

describe("answerResponseSchema", () => {
  it("accepts a grounded answer with sources", () => {
    const parsed = answerResponseSchema.parse({
      answer: "Yes.",
      sources: [{ title: "t", url: "https://example.com" }],
      searched: true,
      live: true,
    });
    expect(parsed.sources).toHaveLength(1);
  });
});
