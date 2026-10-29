"use client";

import { SUPPORTED_LANGUAGES } from "@/lib/validation/schemas";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function LanguageSelector({ value, onChange }: Props) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-medium text-neutral-700">Answer in</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900"
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang} value={lang}>
            {lang}
          </option>
        ))}
      </select>
    </label>
  );
}
