"use client";

import { useEffect, useRef } from "react";
import type { BoundingBox } from "@/lib/segmentation/types";

/** Shared decoded images by URL so N thumbnails decode the photo once. */
const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  const hit = imageCache.get(url);
  if (hit) return hit;
  if (imageCache.size >= 4) {
    const oldest = imageCache.keys().next().value;
    if (oldest !== undefined) imageCache.delete(oldest);
  }
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      imageCache.delete(url);
      reject(new Error("thumbnail image failed to load"));
    };
    img.src = url;
  });
  imageCache.set(url, pending);
  return pending;
}

interface Props {
  imageUrl: string;
  bbox: BoundingBox;
  size?: number;
  shape?: "rounded" | "circle";
}

/**
 * Square object thumbnail cropped from the source photo. Draws once per
 * segment into a small canvas; the photo itself is decoded only once no
 * matter how many rows are shown.
 */
export function SegmentThumbnail({ imageUrl, bbox, size = 44, shape = "rounded" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    loadImage(imageUrl)
      .then((img) => {
        if (cancelled) return;
        const scale = 2; // crisp on retina; still a tiny draw
        canvas.width = size * scale;
        canvas.height = size * scale;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const imgW = img.naturalWidth;
        const imgH = img.naturalHeight;
        if (!imgW || !imgH) return;
        // Centered square covering the bbox, clamped inside the photo.
        const side = Math.min(Math.max(bbox.width, bbox.height), imgW, imgH);
        const cx = bbox.x + bbox.width / 2;
        const cy = bbox.y + bbox.height / 2;
        const qx = Math.max(0, Math.min(imgW - side, Math.round(cx - side / 2)));
        const qy = Math.max(0, Math.min(imgH - side, Math.round(cy - side / 2)));
        ctx.drawImage(img, qx, qy, side, side, 0, 0, canvas.width, canvas.height);
      })
      .catch(() => {
        // Leave the placeholder background; the row is still usable.
      });
    return () => {
      cancelled = true;
    };
  }, [imageUrl, bbox.x, bbox.y, bbox.width, bbox.height, size]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`shrink-0 bg-neutral-200 ${shape === "circle" ? "rounded-full" : "rounded-md"}`}
      style={{ width: size, height: size }}
    />
  );
}
