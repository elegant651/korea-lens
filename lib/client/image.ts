"use client";

import { padBbox } from "@/lib/segmentation/coordinate-mapping";
import type { BoundingBox } from "@/lib/segmentation/types";

export interface LoadedImage {
  url: string;
  base64: string;
  mimeType: string;
  width: number;
  height: number;
}

const ACCEPTED_PREFIXES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Validate an uploaded file and load it into memory (object URL + base64). */
export async function loadImageFile(file: File): Promise<LoadedImage> {
  if (!ACCEPTED_PREFIXES.some((p) => file.type === p || (file.type === "" && /\.jpe?g$/i.test(file.name)))) {
    if (!file.type.startsWith("image/")) {
      throw new Error("Please choose an image file (JPEG, PNG, or WebP).");
    }
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("That image is larger than 10MB. Please choose a smaller one.");
  }
  const url = URL.createObjectURL(file);
  try {
    const dims = await readDimensions(url);
    const base64 = await readBase64(file);
    return { url, base64, mimeType: mimeFor(file), width: dims.width, height: dims.height };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err instanceof Error ? err : new Error("Could not read that image.");
  }
}

function mimeFor(file: File): string {
  if (file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp") {
    return file.type;
  }
  // HEIC and friends: keep the declared type when supported, else assume JPEG bytes.
  if (file.type === "image/heic" || file.type === "image/heif") return file.type;
  return "image/jpeg";
}

function readDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) {
        reject(new Error("Could not read that image."));
        return;
      }
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => reject(new Error("Could not read that image."));
    img.src = url;
  });
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}

/**
 * Crop the selected bbox (with padding) out of the loaded image and return
 * base64 JPEG bytes for the /api/explain route.
 */
export async function cropSelection(
  image: LoadedImage,
  bbox: BoundingBox,
  imageWidth: number,
  imageHeight: number,
): Promise<{ cropBase64: string; mimeType: string }> {
  const padded = padBbox(bbox, imageWidth, imageHeight, 0.12);
  const img = await loadElement(image.url);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(padded.width));
  canvas.height = Math.max(1, Math.round(padded.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not crop the selected object in this browser.");
  ctx.drawImage(
    img,
    padded.x,
    padded.y,
    padded.width,
    padded.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { cropBase64: dataUrl.slice(dataUrl.indexOf(",") + 1), mimeType: "image/jpeg" };
}

function loadElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not crop the selected object."));
    img.src = url;
  });
}
