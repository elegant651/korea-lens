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

  const handleAsk = useCallback(
    async (q: string) => {
      const img = imageRef.current;
      const seg = segments.find((s) => s.id === selectedId);
      if (!img || !seg || q.trim().length === 0) return;
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
    [segments, selectedId, sampleMode, language],
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
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-neutral-900">KoreaLens</h1>
          <p className="text-sm text-neutral-600">Point at Korea. Understand everything.</p>
        </div>
        {phase !== "upload" && (
          <button
            type="button"
            onClick={startOver}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700"
          >
            New photo
          </button>
        )}
      </header>

      {phase === "upload" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed text-neutral-700">
            Take a photo of a store shelf, menu, or sign. Then tell KoreaLens what to find — tap
            an object and ask what it is, in your language. Photos are processed to provide
            visual assistance and are not stored.
          </p>
          <ImageUploader onFile={handleFile} onSample={handleSample} />
          {segmentError && <ErrorBox failure={segmentError} />}
        </div>
      )}

      {phase === "command" && image && (
        <div className="flex flex-col gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt="Uploaded photo preview"
            className="w-full rounded-lg"
            style={{ aspectRatio: `${image.width} / ${image.height}`, objectFit: "contain" }}
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
                className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-teal-700"
                aria-hidden
              />
              <p className="text-sm font-medium text-neutral-700">
                Finding objects{attempts > 1 ? ` (attempt ${attempts})` : ""}…
              </p>
            </div>
          ) : (
            <>
              <SegmentationCanvas
                imageUrl={image.url}
                imageWidth={image.width}
                imageHeight={image.height}
                segments={segments}
                selectedId={selectedId}
                onSelect={setSelectedId}
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
                      className="rounded-full border border-teal-700 bg-white px-3 py-1 text-xs font-medium text-teal-800 disabled:opacity-40"
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
                    className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-teal-700"
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
