"use client";

import { useEffect, useRef, useState } from "react";
import type { Segment } from "@/lib/segmentation/types";
import { SegmentThumbnail } from "./segment-thumbnail";

interface Props {
  segments: Segment[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onClear: () => void;
  onRetry: () => void;
  /** Run segmentation for a different object title. */
  onSearch: (concept: string) => void;
  /** Source photo URL for thumbnails; rows render without them when null. */
  imageUrl: string | null;
  disabled?: boolean;
}

export function SegmentList({
  segments,
  selectedId,
  onSelect,
  onClear,
  onRetry,
  onSearch,
  imageUrl,
  disabled,
}: Props) {
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  const [search, setSearch] = useState("");

  const submitSearch = () => {
    if (search.trim().length === 0) return;
    onSearch(search.trim());
    setSearch("");
  };

  // When an object is tapped on the image, bring its list row into view.
  useEffect(() => {
    if (!selectedId) return;
    const el = itemRefs.current.get(selectedId);
    if (!el) return;
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
  }, [selectedId]);

  if (segments.length === 0) return null;
  return (
    <section aria-label="Detected objects" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-800">
          {segments.length} object{segments.length === 1 ? "" : "s"} found — tap one above or pick here
        </h2>
      </div>
      <ul
        className="flex max-h-[180px] flex-col gap-1.5 overflow-y-auto pr-1"
        role="listbox"
        aria-label="Detected object candidates"
      >
        {segments.map((seg: Segment, i: number) => {
          const isSelected = seg.id === selectedId;
          return (
            <li
              key={seg.id}
              ref={(el) => {
                if (el) itemRefs.current.set(seg.id, el);
                else itemRefs.current.delete(seg.id);
              }}
            >
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={disabled}
                onClick={() => onSelect(isSelected ? null : seg.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm disabled:opacity-50 ${isSelected
                    ? "border-blue-600 bg-blue-50 font-semibold text-blue-900"
                    : "border-neutral-200 bg-white text-neutral-800"
                  }`}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2.5">
                  {imageUrl && <SegmentThumbnail imageUrl={imageUrl} bbox={seg.bbox} />}
                  <span className="truncate">
                    {i + 1}. {seg.label ?? "object"}
                  </span>
                </span>
                {seg.score !== null && (
                  <span className="shrink-0 text-xs text-neutral-500">
                    {Math.round(seg.score * 100)}%
                  </span>
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
      <div className="flex gap-2">
        <input
          type="text"
          value={search}
          maxLength={100}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitSearch();
          }}
          placeholder="Find another object…"
          disabled={disabled}
          aria-label="Find another object"
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 disabled:bg-neutral-100"
        />
        <button
          type="button"
          onClick={submitSearch}
          disabled={disabled || search.trim().length === 0}
          className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          Find
        </button>
      </div>
    </section>
  );
}
