"use client";

import { useState } from "react";
import type { ExplainResponse } from "@/lib/validation/schemas";

interface Props {
  explanation: ExplainResponse;
  onFollowUp: (question: string) => void;
  busy?: boolean;
}

export function ExplanationCard({ explanation, onFollowUp, busy }: Props) {
  const [followUp, setFollowUp] = useState("");

  const submit = () => {
    if (followUp.trim().length === 0) return;
    onFollowUp(followUp.trim());
    setFollowUp("");
  };

  return (
    <section
      aria-label="Explanation"
      aria-live="polite"
      className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-bold text-neutral-900">{explanation.likelyName}</h2>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
            explanation.live ? "bg-teal-100 text-teal-900" : "bg-amber-100 text-amber-900"
          }`}
        >
          {explanation.live ? "Live answer" : "Sample"}
        </span>
      </div>

      <p className="text-sm leading-relaxed text-neutral-800">{explanation.shortDescription}</p>

      {explanation.travelContext && (
        <p className="text-sm leading-relaxed text-neutral-700">
          <span className="font-semibold">Travel tip: </span>
          {explanation.travelContext}
        </p>
      )}

      {explanation.koreanPhrase && (
        <div className="rounded-md bg-neutral-100 p-3">
          <p className="text-xs font-medium text-neutral-500">Show this to store staff</p>
          <p className="text-base font-semibold text-neutral-900">{explanation.koreanPhrase}</p>
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
        AI-generated from the image — it can be wrong. Never treat this as verified ingredient,
        allergy, or safety advice.
      </p>

      <div className="flex gap-2 border-t border-neutral-100 pt-3">
        <input
          type="text"
          value={followUp}
          maxLength={500}
          onChange={(e) => setFollowUp(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Ask a follow-up about this object…"
          disabled={busy}
          aria-label="Follow-up question"
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || followUp.trim().length === 0}
          className="shrink-0 rounded-lg border border-teal-700 px-3 py-2 text-sm font-semibold text-teal-800 disabled:opacity-50"
        >
          {busy ? "…" : "Send"}
        </button>
      </div>
    </section>
  );
}
