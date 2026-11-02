"use client";

import { useRef, useState } from "react";

interface Props {
  onFile: (file: File) => void;
  onSample: () => void;
  disabled?: boolean;
}

export function ImageUploader({ onFile, onSample, disabled }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const handle = (files: FileList | null) => {
    setError(null);
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    onFile(file);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => cameraRef.current?.click()}
          className="rounded-xl bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
        >
          Take a photo
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => uploadRef.current?.click()}
          className="rounded-xl border border-neutral-300 bg-white px-4 py-3.5 text-sm font-semibold text-neutral-900 shadow-sm disabled:opacity-50"
        >
          Upload image
        </button>
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-label="Take a photo"
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Upload an image"
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = "";
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={onSample}
        className="text-sm font-medium text-blue-700 underline underline-offset-2 disabled:opacity-50"
      >
        No photo handy? Try the labeled sample shelf
      </button>
    </div>
  );
}
