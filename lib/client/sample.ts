"use client";

import type { Segment } from "@/lib/segmentation/types";

/**
 * Clearly-labeled offline sample: a generated convenience-shelf illustration
 * with matching fixture segments. Used ONLY when the user explicitly taps
 * "Try the sample" or when the SAM API is not configured — never presented
 * as a live result. Every surface rendering this data must show the
 * "Sample" badge.
 */
export interface SampleData {
  imageUrl: string;
  base64: string;
  width: number;
  height: number;
  segments: Segment[];
}

const W = 640;
const H = 480;

interface ShelfItem {
  label: string;
  score: number;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  accent: string;
  text: string;
}

const ITEMS: ShelfItem[] = [
  { label: "snack package", score: 0.94, x: 40, y: 90, w: 150, h: 220, color: "#d94f30", accent: "#f5c518", text: "새우깡" },
  { label: "snack package", score: 0.91, x: 210, y: 90, w: 150, h: 220, color: "#1f6f8b", accent: "#ffffff", text: "홈런볼" },
  { label: "drink bottle", score: 0.88, x: 390, y: 120, w: 90, h: 190, color: "#2e933c", accent: "#d8f3dc", text: "밀키스" },
  { label: "drink bottle", score: 0.86, x: 495, y: 120, w: 90, h: 190, color: "#7b2d8b", accent: "#f1c40f", text: "포카리" },
];

export function buildSampleData(): SampleData {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Sample mode needs canvas support.");

  // Shelf background.
  ctx.fillStyle = "#ece7dd";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#8a6f4d";
  ctx.fillRect(0, 330, W, 18);
  ctx.fillStyle = "#6b543a";
  ctx.fillRect(0, 348, W, 132);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "600 22px system-ui, sans-serif";
  ctx.fillText("편의점 · SAMPLE ILLUSTRATION", 40, 420);

  for (const item of ITEMS) {
    ctx.fillStyle = item.color;
    roundRect(ctx, item.x, item.y, item.w, item.h, 14);
    ctx.fill();
    ctx.fillStyle = item.accent;
    ctx.fillRect(item.x + 14, item.y + 16, item.w - 28, 54);
    ctx.fillStyle = "#1a1a1a";
    ctx.font = "700 30px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(item.text, item.x + item.w / 2, item.y + 150);
    ctx.font = "500 15px system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText("SAMPLE", item.x + item.w / 2, item.y + item.h - 22);
    ctx.textAlign = "left";
  }

  const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  const segments: Segment[] = ITEMS.map((item, i) => ({
    id: `sample-${i}`,
    label: item.label,
    score: item.score,
    bbox: { x: item.x, y: item.y, width: item.w, height: item.h },
    polygon: [
      { x: item.x, y: item.y },
      { x: item.x + item.w, y: item.y },
      { x: item.x + item.w, y: item.y + item.h },
      { x: item.x, y: item.y + item.h },
    ],
    mask: null,
  }));

  return {
    imageUrl: dataUrl,
    base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
    width: W,
    height: H,
    segments,
  };
}

/** Labeled sample explanation shown when the vision API is not configured. */
export function buildSampleExplanation(question: string) {
  void question;
  return {
    likelyName: "Sample snack package (illustration)",
    shortDescription:
      "This is a sample answer for the illustrated shelf. In the live app, the selected crop would be sent to a Meta vision-capable model for a grounded explanation of the real product in your photo.",
    travelContext:
      "Sample mode demonstrates the full tap-to-select flow without API credentials. Connect the Meta APIs to explain real photos.",
    koreanPhrase: "이게 뭐예요? (What is this?)",
    uncertainties: ["Sample answer — not based on a real product photo."],
    live: false,
  };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
