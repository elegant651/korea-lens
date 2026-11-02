"use client";

import { useCallback, useRef, useState } from "react";
import { CommandInput } from "@/components/command-input";
import { ExplanationCard } from "@/components/explanation-card";
import { ImageUploader } from "@/components/image-uploader";
import { QuestionInput } from "@/components/question-input";
import { SegmentList } from "@/components/segment-list";
import { SegmentationCanvas } from "@/components/segmentation-canvas";
import { cropSelection, loadImageFile, type LoadedImage } from "@/lib/client/image";
import { buildSampleData, buildSampleExplanation } from "@/lib/client/sample";
import type { Segment } from "@/lib/segmentation/types";
import type {
  AnswerResponse,
  ApiError,
  ExplainResponse,
  SegmentResponse,
  ThreadEntry,
  TranscribeResponse,
} from "@/lib/validation/schemas";

type Phase = "upload" | "command" | "segmenting" | "ready";

interface Failure {
  message: string;
  code: string;
  retryable: boolean;
}

const FALLBACK_PROMPTS = ["snack package", "drink bottle", "food item", "sign"];
const MAX_ATTEMPTS = 4;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok) {
    if (res.status === 413) {
      throw {
        message: "That photo is too large to send. Please use a smaller photo.",
        code: "too_large",
        retryable: false,
      } satisfies Failure;
    }
    const err = (json ?? {}) as Partial<ApiError>;
    const failure: Failure = {
      message: typeof err.error === "string" ? err.error : `Request failed (${res.status}).`,
      code: typeof err.code === "string" ? err.code : "http_error",
      retryable: err.retryable !== false,
    };
    throw failure;
  }
  return json as T;
}

export default function HomePage() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sampleMode, setSampleMode] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [concept, setConcept] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [segmentError, setSegmentError] = useState<Failure | null>(null);
  const [emptyResult, setEmptyResult] = useState(false);

  const [question, setQuestion] = useState("What is this?");
  const [answeredQuestion, setAnsweredQuestion] = useState("");
  const [language, setLanguage] = useState<string>("English");
  const [explanation, setExplanation] = useState<ExplainResponse | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<Failure | null>(null);
  const [thread, setThread] = useState<ThreadEntry[]>([]);
  const [answeringFollowUp, setAnsweringFollowUp] = useState(false);

  const imageRef = useRef<LoadedImage | null>(null);
  imageRef.current = image;
  const explanationRef = useRef<ExplainResponse | null>(null);
  explanationRef.current = explanation;

  const resetForNewImage = () => {
    setDrawMode(false);
    setSegments([]);
    setSelectedId(null);
    setSegmentError(null);
    setEmptyResult(false);
    setExplanation(null);
    setExplainError(null);
    setAnsweredQuestion("");
    setThread([]);
    setAttempts(0);
  };

  const runSegmentation = useCallback(
    async (img: LoadedImage, conceptText: string, attempt = 1): Promise<void> => {
      setPhase("segmenting");
      setSegmentError(null);
      setEmptyResult(false);
      setExplanation(null);
      setAttempts(attempt);
      try {
        const result = await postJson<SegmentResponse>("/api/segment", {
          imageBase64: img.base64,
          mimeType: img.mimeType,
          imageWidth: img.width,
          imageHeight: img.height,
          prompt: conceptText.trim(),
        });
        setSegments(result.segments);
        setSelectedId(null);
        setEmptyResult(result.segments.length === 0);
        setPhase("ready");
      } catch (err) {
        setPhase("ready");
        setSegmentError(err as Failure);
      }
    },
    [],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setSegmentError(null);
      try {
        const img = await loadImageFile(file);
        setImage((prev) => {
          if (prev && prev.url.startsWith("blob:")) URL.revokeObjectURL(prev.url);
          return img;
        });
        setSampleMode(false);
        resetForNewImage();
        setConcept("");
        setPhase("command");
      } catch (err) {
        setSegmentError({
          message: err instanceof Error ? err.message : "Could not read that image.",
          code: "bad_image",
          retryable: false,
        });
      }
    },
    [],
  );

  const handleSample = useCallback(() => {
    try {
      const sample = buildSampleData();
      setImage((prev) => {
        if (prev && prev.url.startsWith("blob:")) URL.revokeObjectURL(prev.url);
        return {
          url: sample.imageUrl,
          base64: sample.base64,
          mimeType: "image/jpeg",
          width: sample.width,
          height: sample.height,
        };
      });
      setSampleMode(true);
      resetForNewImage();
      setSegments(sample.segments);
      setPhase("ready");
    } catch (err) {
      setSegmentError({
        message: err instanceof Error ? err.message : "Could not build the sample.",
        code: "sample_error",
        retryable: true,
      });
    }
  }, []);

  const askQuestion = useCallback(
    async (img: LoadedImage, seg: Segment, q: string) => {
      if (q.trim().length === 0) return;
      setExplaining(true);
      setAnsweringFollowUp(false);
      setExplainError(null);
      setAnsweredQuestion(q.trim());
      try {
        if (sampleMode) {
          // Clearly-labeled offline sample answer; never presented as live.
          await new Promise((r) => setTimeout(r, 400));
          setExplanation(buildSampleExplanation(q) as ExplainResponse);
          setThread([]);
          return;
        }
        const crop = await cropSelection(img, seg.bbox, img.width, img.height);
        const result = await postJson<ExplainResponse>("/api/explain", {
          cropBase64: crop.cropBase64,
          mimeType: crop.mimeType,
          question: q.trim(),
          language,
        });
        setExplanation(result);
        setThread([]);
      } catch (err) {
        if (err instanceof Error) {
          setExplainError({ message: err.message, code: "crop_error", retryable: true });
        } else {
          setExplainError(err as Failure);
        }
      } finally {
        setExplaining(false);
      }
    },
    [sampleMode, language],
  );

  const handleAsk = useCallback(
    async (q: string) => {
      const img = imageRef.current;
      const seg = segments.find((s) => s.id === selectedId);
      if (!img || !seg) return;
      await askQuestion(img, seg, q);
    },
    [segments, selectedId, askQuestion],
  );

  const runBoxSegmentation = useCallback(
    async (img: LoadedImage, box: { x: number; y: number; width: number; height: number }) => {
      setDrawMode(false);
      setPhase("segmenting");
      setSegmentError(null);
      setEmptyResult(false);
      setExplanation(null);
      try {
        if (sampleMode) {
          // The user's own box, honestly labeled as a sample result.
          await new Promise((r) => setTimeout(r, 400));
          const seg: Segment = {
            id: `manual-${Date.now()}`,
            label: "selected region",
            score: null,
            bbox: box,
            polygon: [
              { x: box.x, y: box.y },
              { x: box.x + box.width, y: box.y },
              { x: box.x + box.width, y: box.y + box.height },
              { x: box.x, y: box.y + box.height },
            ],
            mask: null,
          };
          setSegments((prev) => [...prev, seg]);
          setSelectedId(seg.id);
          setPhase("ready");
          await askQuestion(img, seg, "What is this?");
          return;
        }
        const result = await postJson<SegmentResponse>("/api/segment", {
          imageBase64: img.base64,
          mimeType: img.mimeType,
          imageWidth: img.width,
          imageHeight: img.height,
          box,
        });
        if (result.segments.length === 0) {
          setEmptyResult(true);
          setPhase("ready");
          return;
        }
        setSegments((prev) => [...prev, ...result.segments]);
        setSelectedId(result.segments[0].id);
        setPhase("ready");
        await askQuestion(img, result.segments[0], "What is this?");
      } catch (err) {
        setPhase("ready");
        setSegmentError(err as Failure);
      }
    },
    [sampleMode, askQuestion],
  );

  const handleFollowUp = useCallback(
    async (q: string) => {
      const current = explanationRef.current;
      if (!current || q.trim().length === 0) return;
      setExplaining(true);
      setAnsweringFollowUp(true);
      setExplainError(null);
      try {
        if (sampleMode) {
          await new Promise((r) => setTimeout(r, 400));
          setThread((prev) => [
            ...prev,
            {
              question: q.trim(),
              answer:
                "This is a sample follow-up answer. In the live app, the identified name is answered from knowledge and live web search instead of the image.",
              sources: [],
              searched: false,
              live: false,
            },
          ]);
          return;
        }
        const result = await postJson<AnswerResponse>("/api/answer", {
          objectName: current.likelyName,
          objectContext: current.shortDescription,
          question: q.trim(),
          language,
        });
        setThread((prev) => [
          ...prev,
          {
            question: q.trim(),
            answer: result.answer,
            sources: result.sources,
            searched: result.searched,
            live: result.live,
          },
        ]);
      } catch (err) {
        if (err instanceof Error) {
          setExplainError({ message: err.message, code: "answer_error", retryable: true });
        } else {
          setExplainError(err as Failure);
        }
      } finally {
        setExplaining(false);
        setAnsweringFollowUp(false);
      }
    },
    [sampleMode, language],
  );

  const handleTranscribe = useCallback(
    async (audioBase64: string): Promise<string> => {
      try {
        const result = await postJson<TranscribeResponse>("/api/transcribe", {
          audioBase64,
          mimeType: "audio/wav",
          language,
        });
        return result.transcript;
      } catch (err) {
        throw new Error((err as Failure).message || "Transcription failed. Please try again.");
      }
    },
    [language],
  );

  const startOver = () => {
    setImage((prev) => {
      if (prev && prev.url.startsWith("blob:")) URL.revokeObjectURL(prev.url);
      return null;
    });
    setSampleMode(false);
    resetForNewImage();
    setQuestion("What is this?");
    setPhase("upload");
  };

  const selected = segments.find((s) => s.id === selectedId) ?? null;
  const showFallbacks =
    (emptyResult || (segmentError && attempts < MAX_ATTEMPTS)) && !sampleMode && image !== null;

  return (
    <main className="flex flex-col gap-4 px-4 pb-10 pt-4">
      <header className="sticky top-0 z-10 -mx-4 border-b border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <svg width="42" height="42" viewBox="0 0 40 40" aria-hidden className="shrink-0">
              <defs>
                <linearGradient id="kl-logo" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#3b82f6" />
                  <stop offset="1" stopColor="#7c3aed" />
                </linearGradient>
              </defs>
              <rect width="40" height="40" rx="11" fill="url(#kl-logo)" />
              <circle cx="18" cy="20" r="8.5" fill="none" stroke="#fff" strokeWidth="3" />
              <circle cx="18" cy="20" r="3" fill="#fff" />
              <path
                d="M30 4.5 L31.4 8.6 L35.5 10 L31.4 11.4 L30 15.5 L28.6 11.4 L24.5 10 L28.6 8.6 Z"
                fill="#fde047"
              />
            </svg>
            <div>
              <h1 className="text-[26px] font-extrabold leading-none tracking-tight text-blue-950">
                KoreaLens
              </h1>
              <p className="mt-1 text-xs font-medium text-blue-950/70">
                Point at Korea. Understand everything.
              </p>
            </div>
          </div>
          {phase !== "upload" && (
            <button
              type="button"
              onClick={startOver}
              className="shrink-0 rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700"
            >
              New photo
            </button>
          )}
        </div>
      </header>

      {phase === "upload" && (
        <div className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <p className="text-sm leading-relaxed text-neutral-700">
            Visiting Korea and puzzled by something you see? Snap a photo, and KoreaLens will
            explain it in your language. Photos are only processed to help you — never stored.
          </p>
          <div className="flex items-start justify-around" aria-label="Select, ask, explore">
            {[
              ["Select", "M7 3.5H3.5V7M17 3.5h3.5V7M7 20.5H3.5V17M17 20.5h3.5V17"],
              ["Ask", "M4 5.5h16V16H9.5L4.5 20.5V5.5Z"],
              ["Explore", "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM3.5 12h17M12 3.5c-4.5 3.5-4.5 13.5 0 17M12 3.5c4.5 3.5 4.5 13.5 0 17"],
            ].map(([label, path]) => (
              <div key={label} className="flex flex-col items-center gap-1">
                <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-blue-600 bg-white">
                  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden fill="none" stroke="#2563eb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d={path} />
                  </svg>
                </span>
                <span className="text-xs font-semibold text-neutral-700">{label}</span>
              </div>
            ))}
          </div>
          <ol className="flex flex-col gap-2" aria-label="How it works">
            {[
              ["1", "Snap a shelf, menu, or sign"],
              ["2", "Name what to find, by typing or voice"],
              ["3", "Tap an object and ask anything"],
            ].map(([n, text]) => (
              <li key={n} className="flex items-center gap-2.5 text-sm text-neutral-700">
                <span
                  aria-hidden
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white"
                >
                  {n}
                </span>
                {text}
              </li>
            ))}
          </ol>
          <ImageUploader onFile={handleFile} onSample={handleSample} />
          {segmentError && <ErrorBox failure={segmentError} />}
        </div>
      )}

      {phase === "command" && image && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawMode((v) => !v)}
              aria-pressed={drawMode}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                drawMode
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-neutral-300 bg-white text-neutral-700"
              }`}
            >
              {drawMode ? "Cancel drawing" : "Draw a box"}
            </button>
            {drawMode ? (
              <p className="text-xs text-neutral-500" role="status">
                Drag on the photo to outline an object, then release.
              </p>
            ) : (
              <p className="text-xs text-neutral-500">…or outline an object directly.</p>
            )}
          </div>
          <SegmentationCanvas
            imageUrl={image.url}
            imageWidth={image.width}
            imageHeight={image.height}
            segments={[]}
            selectedId={null}
            onSelect={() => {}}
            drawMode={drawMode}
            onBoxDrawn={(box) => runBoxSegmentation(image, box)}
          />
          <CommandInput
            concept={concept}
            onConceptChange={setConcept}
            onSubmit={() => runSegmentation(image, concept)}
            onTranscribe={handleTranscribe}
          />
        </div>
      )}

      {(phase === "segmenting" || phase === "ready") && image && (
        <>
          {sampleMode && (
            <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900">
              Sample mode — illustrated shelf and answers, not live AI results. Upload a real
              photo for live segmentation.
            </p>
          )}

          {phase === "segmenting" ? (
            <div
              className="flex flex-col items-center gap-2 rounded-lg bg-neutral-100 py-16"
              role="status"
              aria-live="polite"
            >
              <div
                className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-blue-600"
                aria-hidden
              />
              <p className="text-sm font-medium text-neutral-700">
                Finding objects{attempts > 1 ? ` (attempt ${attempts})` : ""}…
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDrawMode((v) => !v)}
                  aria-pressed={drawMode}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    drawMode
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-neutral-300 bg-white text-neutral-700"
                  }`}
                >
                  {drawMode ? "Cancel drawing" : "Draw a box"}
                </button>
                {drawMode && (
                  <p className="text-xs text-neutral-500" role="status">
                    Drag on the photo to outline an object, then release.
                  </p>
                )}
              </div>
              <SegmentationCanvas
                imageUrl={image.url}
                imageWidth={image.width}
                imageHeight={image.height}
                segments={segments}
                selectedId={selectedId}
                onSelect={setSelectedId}
                drawMode={drawMode}
                onBoxDrawn={(box) => runBoxSegmentation(image, box)}
              />

              {segmentError && !sampleMode && <ErrorBox failure={segmentError} />}

              {emptyResult && !segmentError && (
                <div className="rounded-lg bg-neutral-100 px-3 py-3" role="status">
                  <p className="text-sm text-neutral-700">
                    No objects found. Try a closer photo, or retry with a narrower prompt:
                  </p>
                </div>
              )}

              {showFallbacks && (
                <div className="flex flex-wrap gap-1.5" aria-label="Retry with a narrower prompt">
                  {FALLBACK_PROMPTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      disabled={attempts >= MAX_ATTEMPTS}
                      onClick={() => {
                        setConcept(p);
                        runSegmentation(image, p, attempts + 1);
                      }}
                      className="rounded-full border border-blue-600 bg-white px-3 py-1 text-xs font-medium text-blue-700 disabled:opacity-40"
                    >
                      Find: {p}
                    </button>
                  ))}
                  {attempts >= MAX_ATTEMPTS && (
                    <p className="w-full text-xs text-neutral-500">
                      Retry limit reached — please try a different photo.
                    </p>
                  )}
                </div>
              )}

              <SegmentList
                segments={segments}
                selectedId={selectedId}
                imageUrl={image.url}
                onSearch={(c) => {
                  setConcept(c);
                  runSegmentation(image, c, 1);
                }}
                onSelect={setSelectedId}
                onClear={() => {
                  setSelectedId(null);
                  setExplanation(null);
                  setAnsweredQuestion("");
                  setThread([]);
                }}
                onRetry={() => image && runSegmentation(image, concept)}
              />

              {segments.length > 0 && (
                <div className="sticky bottom-0 z-10 -mx-4 border-t border-neutral-200 bg-neutral-50/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
                  <QuestionInput
                    question={question}
                    onQuestionChange={setQuestion}
                    language={language}
                    onLanguageChange={setLanguage}
                    onSubmit={() => handleAsk(question)}
                    hasSelection={selected !== null}
                    busy={explaining}
                  />
                </div>
              )}

              {explainError && <ErrorBox failure={explainError} />}

              {explaining && (
                <div className="flex items-center gap-2 text-sm text-neutral-600" role="status">
                  <div
                    className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-blue-600"
                    aria-hidden
                  />
                  {answeringFollowUp ? "Searching for the answer…" : "Reading the selected object…"}
                </div>
              )}

              {explanation && !explaining && (
                <>
                  <div aria-hidden className="h-16 shrink-0" />
                  <ExplanationCard
                    explanation={explanation}
                    question={answeredQuestion}
                    language={language}
                    busy={explaining}
                    onFollowUp={handleFollowUp}
                    onTranscribe={handleTranscribe}
                    thread={thread}
                    imageUrl={image.url}
                    bbox={selected?.bbox ?? null}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}

function ErrorBox({ failure }: { failure: Failure }) {
  return (
    <div role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-800">
      {failure.message}
      {failure.code === "not_configured" && (
        <span className="mt-1 block text-xs">
          The server has no Meta API credentials yet — see the README to configure them, or try
          the labeled sample from the start screen.
        </span>
      )}
    </div>
  );
}
