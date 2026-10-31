"use client";

import { isRecordingSupported } from "@/lib/client/audio";
import { useVoiceInput } from "@/lib/client/use-voice-input";

interface Props {
  concept: string;
  onConceptChange: (value: string) => void;
  onSubmit: () => void;
  /** Transcribe a WAV base64 clip; resolves with the transcript for review. */
  onTranscribe: (audioBase64: string) => Promise<string>;
  disabled?: boolean;
}

/**
 * The "what should I find?" command step: type a concept noun phrase or say
 * it, review the text, then submit to run SAM segmentation.
 */
export function CommandInput({ concept, onConceptChange, onSubmit, onTranscribe, disabled }: Props) {
  const { voiceState, voiceError, toggleRecording } = useVoiceInput(onTranscribe, onConceptChange);
  const canRecord = isRecordingSupported();
  const ready = concept.trim().length > 0 && voiceState === "idle" && !disabled;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="find-concept" className="text-sm font-medium text-neutral-700">
        What should I find? <span className="font-normal text-neutral-500">(name one thing)</span>
      </label>
      <div className="flex gap-2">
        {canRecord && (
          <button
            type="button"
            onClick={toggleRecording}
            disabled={disabled || voiceState === "working"}
            aria-pressed={voiceState === "recording"}
            aria-label={voiceState === "recording" ? "Stop recording" : "Say what to find"}
            title={voiceState === "recording" ? "Stop recording" : "Say what to find"}
            className={`flex shrink-0 items-center justify-center rounded-lg border px-2.5 disabled:opacity-50 ${
              voiceState === "recording" ? "border-red-600 bg-red-50" : "border-neutral-300 bg-white"
            }`}
          >
            <span
              aria-hidden
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                voiceState === "recording" ? "animate-pulse bg-red-600" : "bg-neutral-500"
              }`}
            />
          </button>
        )}
        <input
          id="find-concept"
          type="text"
          value={concept}
          maxLength={100}
          onChange={(e) => onConceptChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && ready) onSubmit();
          }}
          placeholder={voiceState === "recording" ? "Listening…" : "e.g. snack package"}
          disabled={disabled || voiceState !== "idle"}
          aria-label="Object to find"
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 disabled:bg-neutral-100"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={!ready}
          className="shrink-0 rounded-xl bg-teal-700 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Find
        </button>
      </div>
      {voiceState === "recording" && (
        <p className="text-xs text-red-700" role="status">
          Recording… tap the button to stop (max 30s).
        </p>
      )}
      {voiceState === "working" && (
        <p className="text-xs text-neutral-600" role="status">
          Transcribing…
        </p>
      )}
      {voiceError && (
        <p className="text-xs text-red-700" role="alert">
          {voiceError}
        </p>
      )}
      <p className="text-xs text-neutral-500">
        Tip: name the object (“snack package”), don’t give an order (“find the snacks”).
      </p>
    </div>
  );
}
