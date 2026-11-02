import { describe, expect, it } from "vitest";
import {
  extractOutputText,
  MetaProviderError,
  providerErrorFromResponse,
} from "@/lib/meta/client";
import {
  buildBoxText,
  buildSamRequest,
  InvalidBoxError,
  segmentsFromOutputText,
} from "@/lib/meta/sam";
import { buildVisionRequest } from "@/lib/meta/muse-spark";
import { decodeSegmentMask, maskForegroundCount } from "@/lib/segmentation/mask-decoder";

/**
 * Real SAM 3.1 output grammar, from the official @meta-sam/parser README
 * (frame 0 of a 320x334 image, prompt "button", two objects).
 */
const REAL_SAM_OUTPUT =
  "<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>" +
  "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>" +
  ",1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|>" +
  "<|mask;x=0;y=0;data=27,48,~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@|>";

describe("buildSamRequest", () => {
  it("builds the documented Responses API request for sam-3.1", () => {
    const req = buildSamRequest({
      model: "sam-3.1",
      inputText: "glasses",
      mimeType: "image/jpeg",
      imageBase64: "QUJD",
    });
    expect(req).toEqual({
      model: "sam-3.1",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "glasses" },
            { type: "input_image", image_url: "data:image/jpeg;base64,QUJD" },
          ],
        },
      ],
      metadata: { include_confidence: "true", mask_encoding: "one_bit" },
    });
  });
});

describe("buildBoxText", () => {
  it("builds box-prompt token text with whole clamped pixels", () => {
    expect(buildBoxText({ x: 10.7, y: 20.2, width: 100, height: 50 }, 640, 480)).toBe(
      "<0f>1<|box;x1=10;y1=20;x2=110;y2=70;w=640;h=480|>",
    );
  });

  it("clamps boxes hanging off the image edge", () => {
    expect(buildBoxText({ x: 600, y: 400, width: 100, height: 100 }, 640, 480)).toBe(
      "<0f>1<|box;x1=600;y1=400;x2=639;y2=479;w=640;h=480|>",
    );
  });

  it("rejects degenerate boxes", () => {
    expect(() => buildBoxText({ x: 700, y: 500, width: 10, height: 10 }, 640, 480)).toThrow(
      InvalidBoxError,
    );
  });
});

describe("segmentsFromOutputText", () => {
  it("converts real SAM output into segments with half-open boxes and cropped masks", async () => {
    const segments = await segmentsFromOutputText(REAL_SAM_OUTPUT, "button", 320, 334);
    expect(segments).toHaveLength(2);

    const [first, second] = segments;
    expect(first.id).toBe("sam-0");
    expect(first.label).toBe("button");
    // x2/y2 are inclusive on the wire; our bbox is x/y/width/height.
    expect(first.bbox).toEqual({ x: 211, y: 228, width: 60, height: 27 });
    expect(first.mask).toMatchObject({ width: 60, height: 27, encoding: "base64-bitmap" });
    expect(first.mask?.origin).toEqual({ x: 211, y: 228 });

    // The re-encoded mask must decode to the official raster (1620 px, 1539 fg).
    const raster = decodeSegmentMask(first.mask!);
    expect(raster).toHaveLength(27 * 60);
    expect(maskForegroundCount(raster)).toBe(1539);

    expect(second.id).toBe("sam-1");
    expect(second.bbox).toEqual({ x: 155, y: 228, width: 48, height: 27 });
    const raster2 = decodeSegmentMask(second.mask!);
    expect(maskForegroundCount(raster2)).toBe(1236);
  });

  it("returns [] for empty output (zero matches is normal)", async () => {
    await expect(segmentsFromOutputText("", "button", 320, 334)).resolves.toEqual([]);
    await expect(segmentsFromOutputText("  \n ", "button", 320, 334)).resolves.toEqual([]);
  });

  it("reads confidence when the response carries c fields", async () => {
    const withConf =
      "<0f>1<|box;x1=10;y1=10;x2=19;y2=19;w=320;h=334;c=0.9609375|>" +
      "<|mask;x=0;y=0;c=0.9609375;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>";
    const segments = await segmentsFromOutputText(withConf, "glasses", 320, 334);
    expect(segments).toHaveLength(1);
    expect(segments[0].score).toBeCloseTo(0.9609375);
  });

  it("prefixes ids for manual box results", async () => {
    const segments = await segmentsFromOutputText(REAL_SAM_OUTPUT, "selected region", 320, 334, "manual");
    expect(segments.map((s) => s.id)).toEqual(["manual-0", "manual-1"]);
    expect(segments[0].label).toBe("selected region");
  });

  it("falls back to a bbox-only segment when a mask payload is corrupt", async () => {
    const badMask =
      "<0f>0<|box;x1=10;y1=10;x2=19;y2=19;w=320;h=334|><|mask;x=0;y=0;data=2,2,~!!!!|>";
    const segments = await segmentsFromOutputText(badMask, "glasses", 320, 334);
    expect(segments).toHaveLength(1);
    expect(segments[0].bbox).toEqual({ x: 10, y: 10, width: 10, height: 10 });
    expect(segments[0].mask).toBeNull();
    expect(segments[0].polygon).toHaveLength(4);
  });
});

describe("extractOutputText", () => {
  it("reads output_text from a Responses API response", () => {
    const json = {
      id: "resp_1",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "<0f>hello", annotations: [] }],
        },
      ],
    };
    expect(extractOutputText(json)).toBe("<0f>hello");
  });

  it("returns null for empty output and incomplete responses", () => {
    expect(extractOutputText({ status: "completed", output: [] })).toBeNull();
    expect(extractOutputText({ status: "incomplete", output: [] })).toBeNull();
    expect(extractOutputText(null)).toBeNull();
    expect(extractOutputText("plain string")).toBe("plain string");
  });
});

describe("providerErrorFromResponse", () => {
  it("maps the documented error envelope with safe details", () => {
    const err = providerErrorFromResponse(
      400,
      JSON.stringify({ error: { code: "invalid_request", message: "invalid prompt: bad", type: "invalid_request_error" } }),
    );
    expect(err).toBeInstanceOf(MetaProviderError);
    expect(err.retryable).toBe(false);
    expect(err.safeDetail).toContain("invalid prompt");
  });

  it("flags auth failures as non-retryable with guidance", () => {
    const err = providerErrorFromResponse(401, "unauthorized");
    expect(err.retryable).toBe(false);
    expect(err.safeDetail).toMatch(/MODEL_API_KEY/);
  });

  it("marks rate limits and server errors retryable", () => {
    expect(providerErrorFromResponse(429, "").retryable).toBe(true);
    expect(providerErrorFromResponse(500, "").retryable).toBe(true);
  });
});

describe("buildVisionRequest", () => {
  it("builds the documented vision request with structured JSON output", () => {
    const req = buildVisionRequest({
      model: "muse-spark-1.3",
      instruction: "Be helpful.",
      question: "What is this?",
      language: "English",
      mimeType: "image/jpeg",
      cropBase64: "QUJD",
    });
    expect(req.model).toBe("muse-spark-1.3");
    const content = (
      req.input as Array<{ content: Array<{ type: string; text?: string; image_url?: string }> }>
    )[0].content;
    expect(content[0].type).toBe("input_text");
    expect(content[0].text).toContain("What is this?");
    expect(content[1]).toEqual({ type: "input_image", image_url: "data:image/jpeg;base64,QUJD" });
    const format = (req.text as { format: { type: string; name: string; schema: unknown } }).format;
    expect(format.type).toBe("json_schema");
    expect(format.name).toBe("KoreaLensExplanation");
  });
});
