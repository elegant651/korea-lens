import { useCallback, useEffect, useRef, useState } from "react";
import {
  recordingToWavBase64,
  startRecording,
  type RecordingHandle,
} from "@/lib/client/audio";

export type VoiceState = "idle" | "recording" | "working";

/**
 * Shared tap-to-talk logic: record from the mic, convert to 16 kHz mono WAV,
 * transcribe via onTranscribe, and deliver the transcript for review.
 * The caller owns the text field; this hook never submits anything itself.
 */
export function useVoiceInput(
  onTranscribe: (audioBase64: string) => Promise<string>,
  onTranscript: (text: string) => void,
) {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recordingRef = useRef<RecordingHandle | null>(null);
  const callbacksRef = useRef({ onTranscribe, onTranscript });
  callbacksRef.current = { onTranscribe, onTranscript };

  useEffect(() => {
    return () => {
      recordingRef.current?.cancel();
      recordingRef.current = null;
    };
  }, []);

  const finishRecording = useCallback(async () => {
    const handle = recordingRef.current;
    recordingRef.current = null;
    if (!handle) {
      setVoiceState("idle");
      return;
    }
    setVoiceState("working");
    try {
      const blob = await handle.stop();
      const wavBase64 = await recordingToWavBase64(blob);
      const transcript = await callbacksRef.current.onTranscribe(wavBase64);
      if (transcript.trim().length === 0) {
        setVoiceError("No speech was recognized. Please try again.");
      } else {
        callbacksRef.current.onTranscript(transcript.trim().slice(0, 500));
      }
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : "Voice input failed. Please try again.");
    } finally {
      setVoiceState("idle");
    }
  }, []);

  const toggleRecording = useCallback(async () => {
    if (voiceState === "recording") {
      await finishRecording();
      return;
    }
    setVoiceError(null);
    try {
      recordingRef.current = await startRecording(undefined, () => {
        void finishRecording();
      });
      setVoiceState("recording");
    } catch (err) {
      setVoiceError(
        err instanceof Error && /denied|permission/i.test(err.message)
          ? "Microphone access was denied. Allow it in the browser to use voice input."
          : "Could not start recording in this browser.",
      );
    }
  }, [voiceState, finishRecording]);

  return { voiceState, voiceError, setVoiceError, toggleRecording };
}
