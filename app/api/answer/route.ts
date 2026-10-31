import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { answerQuestion } from "@/lib/meta/answer";
import { MetaConfigError, MetaProviderError } from "@/lib/meta/client";
import { answerRequestSchema, type ApiError } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

function errorBody(code: string, error: string, retryable: boolean, status: number): NextResponse {
  const body: ApiError = { error, code, retryable };
  return NextResponse.json(body, { status });
}

/**
 * POST /api/answer — answer a follow-up question about an already-identified
 * object by name (no image), grounded in live web search when needed.
 * Server-side only; keys never reach the client.
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
    input = answerRequestSchema.parse(json);
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err ? err.issues[0] : undefined;
      return errorBody("invalid_input", first ? first.message : "Invalid request.", false, 400);
    }
    throw err;
  }

  try {
    const result = await answerQuestion({
      objectName: input.objectName,
      objectContext: input.objectContext,
      question: input.question,
      language: input.language,
    });
    return NextResponse.json({ ...result, live: true });
  } catch (err) {
    if (err instanceof MetaConfigError) {
      return errorBody("not_configured", err.message, false, 503);
    }
    if (err instanceof MetaProviderError) {
      console.error(`[answer] provider error (HTTP ${err.status}): ${err.message.slice(0, 300)}`);
      if (err.status === 504) {
        return errorBody("provider_timeout", "The answer timed out. Please try again.", true, 504);
      }
      const detail = err.safeDetail ? ` ${err.safeDetail}` : "";
      return errorBody(
        "provider_error",
        `Could not answer that question.${detail || " Please try again."}`,
        err.retryable,
        502,
      );
    }
    console.error("[answer] unexpected error", err);
    return errorBody("internal_error", "Something went wrong. Please try again.", true, 500);
  }
}
