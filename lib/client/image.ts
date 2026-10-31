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
/** Longest side of the processed upload (keeps API payloads small). */
export const MAX_UPLOAD_DIM = 1600;
export const UPLOAD_JPEG_QUALITY = 0.82;
/** Refuse to send bodies approaching platform limits (Vercel: 4.5MB). */
export const MAX_UPLOAD_BYTES = 4_000_000;

/**
 * Target dimensions that fit within maxDim on the long side, preserving
 * aspect ratio. Never upscales. Pure helper (unit-tested).
 */
export function computeTargetDimensions(
  width: number,
  height: number,
  maxDim: number = MAX_UPLOAD_DIM,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) throw new Error("Invalid image dimensions");
  const scale = Math.min(1, maxDim / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Validate an uploaded file, then normalize it for upload: EXIF-oriented,
 * downscaled to MAX_UPLOAD_DIM, and re-encoded as JPEG. The returned image
 * is the single source of truth for preview, segmentation, and cropping, so
 * coordinates stay consistent everywhere.
 */
export async function loadImageFile(file: File): Promise<LoadedImage> {
  if (!ACCEPTED_PREFIXES.some((p) => file.type === p || (file.type === "" && /\.jpe?g$/i.test(file.name)))) {
    if (!file.type.startsWith("image/")) {
      throw new Error("Please choose an image file (JPEG, PNG, or WebP).");
    }
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("That image is larger than 10MB. Please choose a smaller one.");
  }
  const bitmap = await decodeFile(file);
  try {
    const target = computeTargetDimensions(bitmap.width, bitmap.height);
    const blob = await renderJpeg(bitmap, target.width, target.height, UPLOAD_JPEG_QUALITY);
    if (blob.size > MAX_UPLOAD_BYTES) {
      // Extremely detailed photo: try once more, smaller.
      const small = computeTargetDimensions(bitmap.width, bitmap.height, 1024);
      const retry = await renderJpeg(blob, small.width, small.height, 0.75);
      if (retry.size > MAX_UPLOAD_BYTES) {
        throw new Error("That photo is too large to send. Please choose a smaller one.");
      }
      return await toLoadedImage(retry, small.width, small.height);
    }
    return await toLoadedImage(blob, target.width, target.height);
  } finally {
    bitmap.close();
  }
}

async function decodeFile(file: File): Promise<ImageBitmap> {
  try {
    if (typeof createImageBitmap === "function") {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    }
  } catch {
    // Fall through to the <img> path below.
  }
  // Fallback for browsers without createImageBitmap.
  const url = URL.createObjectURL(file);
  try {
    const img = await loadElement(url);
    if (!img.naturalWidth || !img.naturalHeight) throw new Error("bad image");
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available in this browser.");
    ctx.drawImage(img, 0, 0);
    return await createImageBitmap(canvas);
  } catch {
    throw new Error("Could not read that image.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function renderJpeg(
  source: ImageBitmap | Blob,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  const render = (img: ImageBitmap | HTMLImageElement, w: number, h: number) =>
    new Promise<Blob>((resolve, reject) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas is not available in this browser."));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Could not read that image."))),
        "image/jpeg",
        quality,
      );
    });
  if (source instanceof Blob) {
    const url = URL.createObjectURL(source);
    return loadElement(url)
      .then((img) => render(img, width, height))
      .finally(() => URL.revokeObjectURL(url));
  }
  return render(source, width, height);
}

async function toLoadedImage(blob: Blob, width: number, height: number): Promise<LoadedImage> {
  const base64 = await blobToBase64(blob);
  return {
    url: URL.createObjectURL(blob),
    base64,
    mimeType: "image/jpeg",
    width,
    height,
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(blob);
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
