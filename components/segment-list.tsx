"use client";

import type { Segment } from "@/lib/segmentation/types";

interface Props {
  segments: Segment[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onClear: () => void;
  onRetry: () => void;
  disabled?: boolean;
}

export function SegmentList({ segments, selectedId, onSelect, onClear, onRetry, disabled }: Props) {
  if (segments.length === 0) return null;
  return (
    <section aria-label="Detected objects" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-800">
          {segments.length} object{segments.length === 1 ? "" : "s"} found — tap one above or pick here
        </h2>
      </div>
      <ul className="flex flex-col gap-1.5" role="listbox" aria-label="Detected object candidates">
        {segments.map((seg: Segment, i: number) => {
          const isSelected = seg.id === selectedId;
          return (
            <li key={seg.id}>
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={disabled}
                onClick={() => onSelect(isSelected ? null : seg.id)}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-50 ${
                  isSelected
                    ? "border-teal-700 bg-teal-50 font-semibold text-teal-900"
                    : "border-neutral-200 bg-white text-neutral-800"
                }`}
              >
                <span>
                  {i + 1}. {seg.label ?? "object"}
                </span>
                {seg.score !== null && (
                  <span className="text-xs text-neutral-500">{Math.round(seg.score * 100)}%</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex gap-3 text-sm">
        <button
          type="button"
          disabled={disabled || !selectedId}
          onClick={onClear}
          className="font-medium text-neutral-600 underline underline-offset-2 disabled:opacity-40"
        >
          Clear selection
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onRetry}
          className="font-medium text-neutral-600 underline underline-offset-2 disabled:opacity-40"
        >
          Retry segmentation
        </button>
      </div>
    </section>
  );
}
