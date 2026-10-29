import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { MetaConfigError, MetaProviderError } from "@/lib/meta/client";
import { segmentImage } from "@/lib/meta/sam";
import { segmentRequestSchema, type ApiError } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

function errorBody(code: string, error: string, retryable: boolean, status: number): NextResponse {
  const body: ApiError = { error, code, retryable };
  return NextResponse.json(body, { status });
}

/**
 * POST /api/segment — segment relevant objects in an uploaded image via SAM.
 * All Meta API calls happen here on the server; keys never reach the client.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return errorBody("invalid_json", "Request body must be valid JSON.", false, 400);
  }

  let input;
  try {
    input = segmentRequestSchema.parse(json);
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return errorBody("invalid_input", first ? first.message : "Invalid request.", false, 400);
    }
    throw err;
  }

  try {
    const result = await segmentImage({
      imageBase64: input.imageBase64,
      mimeType: input.mimeType,
      imageWidth: input.imageWidth,
      imageHeight: input.imageHeight,
      concept: input.prompt,
    });
    return NextResponse.json({ ...result, live: true });
  } catch (err) {
    if (err instanceof MetaConfigError) {
      return errorBody("not_configured", err.message, false, 503);
    }
    if (err instanceof MetaProviderError) {
      // Log provider diagnostics server-side without secrets; return a safe message.
      console.error(`[segment] provider error (HTTP ${err.status}): ${err.message.slice(0, 300)}`);
      if (err.status === 504) {
        return errorBody("provider_timeout", "Segmentation timed out. Please try again.", true, 504);
      }
      const detail = err.safeDetail ? ` ${err.safeDetail}` : "";
      return errorBody(
        "provider_error",
        `Segmentation failed.${detail || " Please try again or use a different photo."}`,
        err.retryable,
        502,
      );
    }
    console.error("[segment] unexpected error", err);
    return errorBody("internal_error", "Something went wrong. Please try again.", true, 500);
  }
}
