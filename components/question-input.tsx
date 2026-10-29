"use client";

import { LanguageSelector } from "./language-selector";

interface Props {
  question: string;
  onQuestionChange: (q: string) => void;
  language: string;
  onLanguageChange: (lang: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  busy?: boolean;
  hasSelection: boolean;
}

const EXAMPLES = ["What is this?", "How is it used?", "Is it spicy?", "Is it sweet?"];

export function QuestionInput({
  question,
  onQuestionChange,
  language,
  onLanguageChange,
  onSubmit,
  disabled,
  busy,
  hasSelection,
}: Props) {
  return (
    <section aria-label="Ask about the selected object" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-neutral-800">Ask about the selected object</h2>
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={disabled || busy}
            onClick={() => onQuestionChange(ex)}
            className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={question}
          maxLength={500}
          onChange={(e) => onQuestionChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit();
          }}
          placeholder={hasSelection ? "Type your question…" : "Select an object first"}
          disabled={disabled || busy || !hasSelection}
          aria-label="Your question"
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 disabled:bg-neutral-100"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || busy || !hasSelection || question.trim().length === 0}
          className="shrink-0 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Asking…" : "Ask"}
        </button>
      </div>
      <LanguageSelector value={language} onChange={onLanguageChange} />
    </section>
  );
}
