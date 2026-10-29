"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  computeContainLayout,
  displayToOriginal,
  findSegmentAtPoint,
  originalToDisplay,
  type ContainLayout,
} from "@/lib/segmentation/coordinate-mapping";
import { decodeSegmentMask } from "@/lib/segmentation/mask-decoder";
import type { Segment } from "@/lib/segmentation/types";

interface Props {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  segments: Segment[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  disabled?: boolean;
}

const PALETTE = ["#14b8a6", "#f59e0b", "#38bdf8", "#fb7185", "#a3e635", "#facc15"];

function colorFor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

/**
 * Renders the source image with segmentation masks/overlays on a canvas and
 * maps pointer taps back to original-image coordinates for selection.
 */
export function SegmentationCanvas({
  imageUrl,
  imageWidth,
  imageHeight,
  segments,
  selectedId,
  onSelect,
  disabled,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [layout, setLayout] = useState<ContainLayout | null>(null);
  const layoutRef = useRef<ContainLayout | null>(null);
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  // Decode bitmap masks once per analysis result.
  const decodedMasks = useMemo(() => {
    const cache = new Map<string, Uint8Array | null>();
    for (const seg of segments) {
      if (!seg.mask) {
        cache.set(seg.id, null);
        continue;
      }
      try {
        cache.set(seg.id, decodeSegmentMask(seg.mask));
      } catch {
        cache.set(seg.id, null);
      }
    }
    return cache;
  }, [segments]);

  const draw = useCallback(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const rect = box.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    const next = computeContainLayout(imageWidth, imageHeight, rect.width, rect.height);
    layoutRef.current = next;
    setLayout(next);

    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const segs = segmentsRef.current;
    segs.forEach((seg, i) => {
      const isSelected = seg.id === selectedId;
      const color = isSelected ? "#fde047" : colorFor(i);
      ctx.save();
      ctx.globalAlpha = selectedId && !isSelected ? 0.25 : 0.55;
      ctx.fillStyle = color;

      const decoded = decodedMasks.get(seg.id);
      if (decoded && seg.mask) {
        drawBitmapMask(ctx, decoded, seg, next, color);
      } else if (seg.polygon && seg.polygon.length >= 3) {
        ctx.beginPath();
        seg.polygon.forEach((p, k) => {
          const d = originalToDisplay(p, next);
          if (k === 0) ctx.moveTo(d.x, d.y);
          else ctx.lineTo(d.x, d.y);
        });
        ctx.closePath();
        ctx.fill();
      } else {
        const topLeft = originalToDisplay({ x: seg.bbox.x, y: seg.bbox.y }, next);
        ctx.fillRect(topLeft.x, topLeft.y, seg.bbox.width * next.scale, seg.bbox.height * next.scale);
      }
      ctx.restore();

      // Outline + index badge.
      ctx.save();
      ctx.globalAlpha = selectedId && !isSelected ? 0.4 : 1;
      ctx.strokeStyle = isSelected ? "#713f12" : color;
      ctx.lineWidth = isSelected ? 3 : 2;
      const tl = originalToDisplay({ x: seg.bbox.x, y: seg.bbox.y }, next);
      const w = seg.bbox.width * next.scale;
      const h = seg.bbox.height * next.scale;
      ctx.strokeRect(tl.x, tl.y, w, h);
      ctx.fillStyle = isSelected ? "#fde047" : "rgba(0,0,0,0.75)";
      const label = String(i + 1);
      const tw = ctx.measureText(label).width;
      ctx.fillRect(tl.x, Math.max(0, tl.y - 20), tw + 12, 20);
      ctx.fillStyle = isSelected ? "#713f12" : "#fff";
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.fillText(label, tl.x + 6, Math.max(0, tl.y - 20) + 14);
      ctx.restore();
    });
  }, [decodedMasks, imageHeight, imageWidth, selectedId]);

  useEffect(() => {
    draw();
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(box);
    return () => observer.disconnect();
  }, [draw, imageUrl]);

  const handlePointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const canvas = canvasRef.current;
    const current = layoutRef.current;
    if (!canvas || !current) return;
    const rect = canvas.getBoundingClientRect();
    const point = displayToOriginal(
      { x: e.clientX - rect.x, y: e.clientY - rect.y },
      current,
      imageWidth,
      imageHeight,
    );
    if (!point) {
      onSelect(null);
      return;
    }
    const hit = findSegmentAtPoint(segmentsRef.current, point, imageWidth, imageHeight, decodedMasks);
    onSelect(hit ? hit.id : null);
  };

  void layout;

  return (
    <div
      ref={boxRef}
      className="relative w-full touch-manipulation select-none overflow-hidden rounded-lg bg-neutral-900"
      style={{ aspectRatio: `${imageWidth} / ${imageHeight}` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt="Uploaded photo being analyzed"
        className="absolute inset-0 h-full w-full object-contain"
        draggable={false}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full cursor-pointer"
        style={{ touchAction: "manipulation" }}
        onPointerDown={handlePointer}
        role="application"
        aria-label={`${segments.length} detected objects. Tap an object to select it.`}
      />
    </div>
  );
}

function drawBitmapMask(
  ctx: CanvasRenderingContext2D,
  decoded: Uint8Array,
  seg: Segment,
  layout: ContainLayout,
  color: string,
): void {
  const mask = seg.mask;
  if (!mask) return;
  const maskWidth = mask.width;
  const maskHeight = mask.height;
  const off = document.createElement("canvas");
  off.width = maskWidth;
  off.height = maskHeight;
  const octx = off.getContext("2d");
  if (!octx) return;
  const img = octx.createImageData(maskWidth, maskHeight);
  const [r, g, b] = hexToRgb(color);
  for (let i = 0; i < decoded.length; i++) {
    if (decoded[i] === 1) {
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (mask.origin) {
    // Box-cropped raster (SAM 3.1): draw within the bbox region.
    const at = originalToDisplay(mask.origin, layout);
    ctx.drawImage(off, at.x, at.y, seg.bbox.width * layout.scale, seg.bbox.height * layout.scale);
  } else {
    ctx.drawImage(off, layout.offsetX, layout.offsetY, layout.displayWidth, layout.displayHeight);
  }
  ctx.restore();
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
