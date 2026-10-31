/**
 * Server-only Meta Model API configuration and fetch helper.
 * Never import this module (or anything under lib/meta) from client code.
 *
 * Contract: Meta Model API, base URL https://api.meta.ai/v1, Responses API
 * (POST /responses), Bearer auth with MODEL_API_KEY.
 * See https://dev.meta.ai/docs/overview
 */

export class MetaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaConfigError";
  }
}

export class MetaProviderError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  /** Short provider message that is safe to show to users (no secrets). */
  readonly safeDetail: string | null;
  constructor(message: string, status: number, retryable: boolean, safeDetail: string | null = null) {
    super(message);
    this.name = "MetaProviderError";
    this.status = status;
    this.retryable = retryable;
    this.safeDetail = safeDetail;
  }
}

export const META_API_BASE_URL = "https://api.meta.ai/v1";
export const DEFAULT_SAM_MODEL = "sam-3.1";
export const DEFAULT_VISION_MODEL = "muse-spark-1.3";

export interface ModelConfig {
  /** Full Responses endpoint URL. */
  apiUrl: string;
  apiKey: string;
  model: string;
}

function readEnv(name: string): string | null {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : null;
}

export function getApiKey(): string {
  const key =
    readEnv("MODEL_API_KEY") ??
    readEnv("META_API_KEY") ??
    readEnv("META_SAM_API_KEY") ??
    readEnv("META_VISION_API_KEY");
  if (!key) {
    throw new MetaConfigError(
      "Meta Model API key is not configured. Set MODEL_API_KEY (see .env.example and the README).",
    );
  }
  return key;
}

export function getBaseUrl(): string {
  return (readEnv("META_API_BASE_URL") ?? META_API_BASE_URL).replace(/\/+$/, "");
}

/** Resolve SAM credentials. Throws MetaConfigError when the key is missing. */
export function getSamConfig(): ModelConfig {
  return {
    apiUrl: `${getBaseUrl()}/responses`,
    apiKey: getApiKey(),
    model: readEnv("META_SAM_MODEL_ID") ?? DEFAULT_SAM_MODEL,
  };
}

/** Resolve vision-model credentials. Throws MetaConfigError when missing. */
export function getVisionConfig(): ModelConfig {
  return {
    apiUrl: `${getBaseUrl()}/responses`,
    apiKey: getApiKey(),
    model: readEnv("META_VISION_MODEL_ID") ?? DEFAULT_VISION_MODEL,
  };
}

/** True when a Model API key is present (used for honest live/sample labeling). */
export function isModelApiConfigured(): boolean {
  try {
    getApiKey();
    return true;
  } catch {
    return false;
  }
}

export interface MetaFetchOptions {
  timeoutMs: number;
  headers?: Record<string, string>;
  body: string;
}

/**
 * POST JSON to a Meta Model API endpoint with a timeout. Maps network
 * failures, timeouts, and provider error statuses to MetaProviderError.
 * Never includes secrets in error messages.
 */
export async function metaPostJson(url: string, options: MetaFetchOptions): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...options.headers },
      body: options.body,
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new MetaProviderError(`Request timed out after ${options.timeoutMs}ms`, 504, true);
    }
    throw new MetaProviderError("Could not reach the Meta Model API endpoint", 502, true);
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw providerErrorFromResponse(res.status, text);
  }
  if (text.trim().length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export interface MetaFormOptions {
  timeoutMs: number;
  headers?: Record<string, string>;
  form: FormData;
}

/**
 * POST multipart/form-data (e.g. the ASR transcribe endpoint) with a timeout.
 * Error mapping matches metaPostJson.
 */
export async function metaPostForm(url: string, options: MetaFormOptions): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { ...options.headers },
      body: options.form,
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new MetaProviderError(`Request timed out after ${options.timeoutMs}ms`, 504, true);
    }
    throw new MetaProviderError("Could not reach the Meta Model API endpoint", 502, true);
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw providerErrorFromResponse(res.status, text);
  }
  if (text.trim().length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * Build a MetaProviderError from an HTTP error status and response body,
 * honoring the documented {error: {code, message}} envelope. The provider
 * message is truncated and safe to surface; the full body stays server-side.
 */
export function providerErrorFromResponse(status: number, bodyText: string): MetaProviderError {
  const envelopeMessage = readEnvelopeMessage(bodyText);
  const retryable = status === 429 || status >= 500;

  if (status === 401 || status === 403) {
    return new MetaProviderError(
      `Meta Model API authentication failed (HTTP ${status})`,
      status,
      false,
      "Authentication failed. Check that MODEL_API_KEY is set to a valid key.",
    );
  }
  if (status === 404) {
    return new MetaProviderError(
      `Meta Model API endpoint or model not found (HTTP 404)`,
      status,
      false,
      envelopeMessage
        ? `Model or endpoint not found: ${envelopeMessage}`
        : "Model or endpoint not found. Verify the model ID and account access.",
    );
  }
  if (status === 400) {
    // 400 is permanent for that request: surface the reason so it can be fixed.
    return new MetaProviderError(
      `Meta Model API rejected the request (HTTP 400)${envelopeMessage ? `: ${envelopeMessage}` : ""}`,
      status,
      false,
      envelopeMessage ?? "The request was rejected. Try a different photo or prompt.",
    );
  }
  if (status === 429) {
    return new MetaProviderError(
      "Meta Model API rate limit exceeded (HTTP 429)",
      status,
      true,
      "Rate limit reached. Please wait a moment and try again.",
    );
  }
  return new MetaProviderError(
    `Meta Model API error (HTTP ${status})${envelopeMessage ? `: ${envelopeMessage}` : ""}`,
    status,
    retryable,
    retryable ? null : envelopeMessage,
  );
}

function readEnvelopeMessage(bodyText: string): string | null {
  try {
    const json = JSON.parse(bodyText) as { error?: { message?: unknown; code?: unknown } };
    const message = json?.error?.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim().slice(0, 300);
    }
    return null;
  } catch {
    const trimmed = bodyText.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 300) : null;
  }
}

/**
 * Extract the assistant output text from a non-streaming Responses API
 * response ({status, output: [{type: 'message', content: [{type:
 * 'output_text', text}]}]}). Returns null when there is no text (e.g. empty
 * output or an incomplete response).
 */
export function extractOutputText(raw: unknown): string | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? raw : null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj["output_text"] === "string" && obj["output_text"].trim().length > 0) {
    return obj["output_text"] as string;
  }
  const output = obj["output"];
  if (!Array.isArray(output)) return null;
  const parts: string[] = [];
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const content = (item as Record<string, unknown>)["content"];
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part !== "object" || part === null) continue;
      const p = part as Record<string, unknown>;
      if (p["type"] === "output_text" && typeof p["text"] === "string" && p["text"].length > 0) {
        parts.push(p["text"] as string);
      }
    }
  }
  return parts.length > 0 ? parts.join("") : null;
}

/** Bearer auth header for the Model API key. */
export function buildAuthHeaders(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}` };
}
