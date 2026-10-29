import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { MetaConfigError, MetaProviderError } from "@/lib/meta/client";
import { explainCrop } from "@/lib/meta/muse-spark";
import { explainRequestSchema, type ApiError } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

function errorBody(code: string, error: string, retryable: boolean, status: number): NextResponse {
  const body: ApiError = { error, code, retryable };
  return NextResponse.json(body, { status });
}

/**
 * POST /api/explain — explain the selected object crop via a Meta
 * vision-capable model. Server-side only; keys never reach the client.
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
    input = explainRequestSchema.parse(json);
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err ? err.issues[0] : undefined;
      return errorBody("invalid_input", first ? first.message : "Invalid request.", false, 400);
    }
    throw err;
  }

  try {
    const explanation = await explainCrop({
      cropBase64: input.cropBase64,
      mimeType: input.mimeType,
      question: input.question,
      language: input.language,
      sceneContext: input.sceneContext,
    });
    return NextResponse.json({ ...explanation, live: true });
  } catch (err) {
    if (err instanceof MetaConfigError) {
      return errorBody("not_configured", err.message, false, 503);
    }
    if (err instanceof MetaProviderError) {
      console.error(`[explain] provider error (HTTP ${err.status}): ${err.message.slice(0, 300)}`);
      if (err.status === 504) {
        return errorBody("provider_timeout", "The answer timed out. Please try again.", true, 504);
      }
      const detail = err.safeDetail ? ` ${err.safeDetail}` : "";
      return errorBody(
        "provider_error",
        `Could not generate an explanation.${detail || " Please try again."}`,
        err.retryable,
        502,
      );
    }
    console.error("[explain] unexpected error", err);
    return errorBody("internal_error", "Something went wrong. Please try again.", true, 500);
  }
}
