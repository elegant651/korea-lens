"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BoundingBox } from "@/lib/segmentation/types";
import type { ExplainResponse, ThreadEntry } from "@/lib/validation/schemas";
import { SegmentThumbnail } from "./segment-thumbnail";
import {
  isRecordingSupported,
  isSpeaking,
  isSpeechSupported,
  speakText,
  stopSpeaking,
} from "@/lib/client/audio";
import { useVoiceInput } from "@/lib/client/use-voice-input";

interface Props {
  explanation: ExplainResponse;
  /** The question this answer responds to. */
  question: string;
  language: string;
  onFollowUp: (question: string) => void;
  /** Transcribe a WAV base64 clip; resolves with the transcript for review. */
  onTranscribe: (audioBase64: string) => Promise<string>;
  /** Name-based follow-up answers appended below the visual answer. */
  thread: ThreadEntry[];
  /** Source photo + selected box for the answer thumbnail. */
  imageUrl: string | null;
  bbox: BoundingBox | null;
  busy?: boolean;
}

export function ExplanationCard({
  explanation,
  question,
  language,
  onFollowUp,
  onTranscribe,
  thread,
  imageUrl,
  bbox,
  busy,
}: Props) {
  const [followUp, setFollowUp] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const speakTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // A new answer always opens expanded.
  useEffect(() => {
    setExpanded(true);
  }, [explanation]);

  // Keep the newest thread messages in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && expanded) {
      el.scrollTop = el.scrollHeight;
    }
  }, [thread.length, expanded]);

  const handleTranscript = useCallback((text: string) => {
    setFollowUp(text);
    inputRef.current?.focus();
  }, []);
  const { voiceState, voiceError, toggleRecording } = useVoiceInput(onTranscribe, handleTranscript);

  useEffect(() => {
    return () => {
      stopSpeaking();
      if (speakTimer.current) clearInterval(speakTimer.current);
    };
  }, []);

  const submit = () => {
    if (followUp.trim().length === 0) return;
    // Keep the asked question in the field so it stays visible.
    onFollowUp(followUp.trim());
  };

  const toggleSpeech = () => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      if (speakTimer.current) clearInterval(speakTimer.current);
      return;
    }
    if (!explanation.koreanPhrase) return;
    speakText(explanation.koreanPhrase, "Korean");
    setSpeaking(true);
    if (speakTimer.current) clearInterval(speakTimer.current);
    speakTimer.current = setInterval(() => {
      if (!isSpeaking()) {
        setSpeaking(false);
        if (speakTimer.current) clearInterval(speakTimer.current);
      }
    }, 500);
  };

  const canRecord = isRecordingSupported();

  return (
    <div className="fixed inset-x-0 bottom-0 z-20" aria-label="Explanation">
      <div className="mx-auto w-full max-w-xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {!expanded ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-expanded={false}
            aria-label={`Show answer: ${explanation.likelyName}`}
            className="flex w-full items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-left shadow-lg"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-bold text-neutral-900">
              {explanation.likelyName}
            </span>
            <LiveBadge live={explanation.live} />
            <span aria-hidden className="text-lg leading-none text-neutral-500">
              ▴
            </span>
          </button>
        ) : (
          <section
            aria-live="polite"
            className="flex max-h-[62dvh] flex-col rounded-t-2xl border border-neutral-200 bg-white shadow-xl"
          >
            <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-4 py-2">
              <div aria-hidden className="h-1 w-10 rounded-full bg-neutral-300" />
              <div className="flex items-center gap-1">
                <LiveBadge live={explanation.live} />
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  aria-expanded={true}
                  aria-label="Shrink answer card"
                  className="rounded-md px-2 py-0.5 text-lg leading-none text-neutral-500"
                >
                  ▾
                </button>
              </div>
            </div>

            <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
              <div className="flex items-center gap-3">
                {imageUrl && bbox && (
                  <SegmentThumbnail imageUrl={imageUrl} bbox={bbox} size={56} shape="circle" />
                )}
                <h2 className="min-w-0 flex-1 text-lg font-extrabold leading-snug text-blue-950">
                  {explanation.likelyName}
                </h2>
              </div>

              {question.trim().length > 0 && (
                <p className="border-l-2 border-blue-600 pl-2 text-sm italic text-neutral-600">
                  {question}
                </p>
              )}

              <p className="text-sm leading-relaxed text-neutral-800">
                {explanation.shortDescription}
              </p>

              {explanation.travelContext && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3">
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden className="mt-0.5 shrink-0">
                    <path
                      d="M12 2.5a7.5 7.5 0 0 0-4.3 13.6c.7.6 1.1 1.2 1.3 2.1h6c.2-.9.6-1.5 1.3-2.1A7.5 7.5 0 0 0 12 2.5Z"
                      fill="#fbbf24"
                    />
                    <path d="M9.5 20.5h5" stroke="#92400e" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                  <p className="text-sm leading-relaxed text-neutral-700">{explanation.travelContext}</p>
                </div>
              )}

              {explanation.koreanPhrase && (
                <div className="rounded-lg bg-blue-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-blue-700">In Korean — show to staff</p>
                      <p className="mt-0.5 text-base font-bold text-blue-950">
                        {explanation.koreanPhrase}
                      </p>
                    </div>
                    {isSpeechSupported() && (
                      <button
                        type="button"
                        onClick={toggleSpeech}
                        aria-pressed={speaking}
                        aria-label={speaking ? "Stop reading phrase" : "Listen to the Korean phrase"}
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm ${
                          speaking ? "animate-pulse" : ""
                        }`}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          {speaking ? (
                            <path d="M6 6l12 12M18 6L6 18" />
                          ) : (
                            <>
                              <path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" fill="currentColor" stroke="none" />
                              <path d="M15 9.5a4 4 0 0 1 0 5M17.5 7a7.5 7.5 0 0 1 0 10" />
                            </>
                          )}
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {explanation.uncertainties.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {explanation.uncertainties.map((u, i) => (
                    <li key={i} className="text-xs leading-relaxed text-neutral-500">
                      ⚠ {u}
                    </li>
                  ))}
                </ul>
              )}

              <p className="text-xs text-neutral-400">
                AI-generated from the image — it can be wrong. Never treat this as verified
                ingredient, allergy, or safety advice.
              </p>

              {thread.length > 0 && (
                <ol
                  className="flex flex-col gap-2 border-t border-neutral-100 pt-3"
                  aria-label="Follow-up answers"
                >
                  {thread.map((entry, i) => (
                    <li key={i} className="flex flex-col gap-1.5 rounded-md bg-neutral-50 p-2.5">
                      <p className="text-xs font-medium italic text-neutral-600">
                        {entry.question}
                      </p>
                      <p className="text-sm leading-relaxed text-neutral-800">{entry.answer}</p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {entry.searched && (
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-900">
                            web search
                          </span>
                        )}
                        {!entry.live && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                            Sample
                          </span>
                        )}
                        {entry.sources.map((s) => (
                          <a
                            key={s.url}
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className="max-w-full truncate text-[11px] text-blue-700 underline underline-offset-2"
                          >
                            {s.title}
                          </a>
                        ))}
                      </div>
                    </li>
                  ))}
                </ol>
              )}

            </div>

            <div className="flex shrink-0 flex-col gap-1.5 border-t border-neutral-100 bg-white px-4 py-3">
              <div className="flex gap-2">
                {canRecord && (
                  <button
                    type="button"
                    onClick={toggleRecording}
                    disabled={busy || voiceState === "working"}
                    aria-pressed={voiceState === "recording"}
                    aria-label={voiceState === "recording" ? "Stop recording" : "Ask by voice"}
                    title={voiceState === "recording" ? "Stop recording" : "Ask by voice"}
                    className={`flex shrink-0 items-center justify-center rounded-lg border px-2.5 disabled:opacity-50 ${voiceState === "recording"
                        ? "border-red-600 bg-red-50"
                        : "border-neutral-300 bg-white"
                      }`}
                  >
                    <span
                      aria-hidden
                      className={`inline-block h-2.5 w-2.5 rounded-full ${voiceState === "recording"
                          ? "animate-pulse bg-red-600"
                          : "bg-neutral-500"
                        }`}
                    />
                  </button>
                )}
                <input
                  ref={inputRef}
                  type="text"
                  value={followUp}
                  maxLength={500}
                  onChange={(e) => setFollowUp(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                  }}
                  placeholder={
                    voiceState === "recording"
                      ? "Listening… tap stop when done"
                      : voiceState === "working"
                        ? "Transcribing…"
                        : "Ask a follow-up about this object…"
                  }
                  disabled={busy || voiceState !== "idle"}
                  aria-label="Follow-up question"
                  className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 disabled:bg-neutral-100"
                />
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy || voiceState !== "idle" || followUp.trim().length === 0}
                  className="shrink-0 rounded-lg border border-blue-700 px-3 py-2 text-sm font-semibold text-blue-700 disabled:opacity-50"
                >
                  {busy ? "…" : "Send"}
                </button>
              </div>
              {voiceState === "recording" && (
                <p className="text-xs text-red-700" role="status">
                  Recording… tap the button to stop (max 30s).
                </p>
              )}
              {voiceError && (
                <p className="text-xs text-red-700" role="alert">
                  {voiceError}
                </p>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function LiveBadge({ live }: { live: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${live ? "bg-blue-100 text-blue-900" : "bg-amber-100 text-amber-900"
        }`}
    >
      {live ? "Live answer" : "Sample"}
    </span>
  );
}

