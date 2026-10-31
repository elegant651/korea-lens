"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExplainResponse, ThreadEntry } from "@/lib/validation/schemas";
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
  busy?: boolean;
}

export function ExplanationCard({
  explanation,
  question,
  language,
  onFollowUp,
  onTranscribe,
  thread,
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
    speakText(speechText(explanation), language);
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
            <div className="flex flex-col gap-1 border-b border-neutral-100 px-4 pb-2 pt-2">
              <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-neutral-300" />
              <div className="flex items-start justify-between gap-2">
                <h2 className="min-w-0 flex-1 truncate text-base font-bold text-neutral-900">
                  {explanation.likelyName}
                </h2>
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
              {question.trim().length > 0 && (
                <p className="border-l-2 border-teal-600 pl-2 text-sm italic text-neutral-600">
                  {question}
                </p>
              )}
              {isSpeechSupported() && (
                <button
                  type="button"
                  onClick={toggleSpeech}
                  aria-pressed={speaking}
                  className="flex w-fit items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700"
                >
                  <span aria-hidden className={speaking ? "animate-pulse" : ""}>
                    {speaking ? "■" : "▶"}
                  </span>
                  {speaking ? "Stop" : "Listen"}
                </button>
              )}

              <p className="text-sm leading-relaxed text-neutral-800">
                {explanation.shortDescription}
              </p>

              {explanation.travelContext && (
                <p className="text-sm leading-relaxed text-neutral-700">
                  <span className="font-semibold">Travel tip: </span>
                  {explanation.travelContext}
                </p>
              )}

              {explanation.koreanPhrase && (
                <div className="rounded-md bg-neutral-100 p-3">
                  <p className="text-xs font-medium text-neutral-500">Show this to store staff</p>
                  <p className="text-base font-semibold text-neutral-900">
                    {explanation.koreanPhrase}
                  </p>
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
                            className="max-w-full truncate text-[11px] text-teal-800 underline underline-offset-2"
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
                      className={`flex shrink-0 items-center justify-center rounded-lg border px-2.5 disabled:opacity-50 ${
                        voiceState === "recording"
                          ? "border-red-600 bg-red-50"
                          : "border-neutral-300 bg-white"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`inline-block h-2.5 w-2.5 rounded-full ${
                          voiceState === "recording"
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
                    className="shrink-0 rounded-lg border border-teal-700 px-3 py-2 text-sm font-semibold text-teal-800 disabled:opacity-50"
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
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
        live ? "bg-teal-100 text-teal-900" : "bg-amber-100 text-amber-900"
      }`}
    >
      {live ? "Live answer" : "Sample"}
    </span>
  );
}

function speechText(explanation: ExplainResponse): string {
  const parts = [`${explanation.likelyName}.`, explanation.shortDescription];
  if (explanation.travelContext) parts.push(explanation.travelContext);
  if (explanation.koreanPhrase) parts.push(`In Korean: ${explanation.koreanPhrase}.`);
  return parts.join(" ");
}
