import { describe, expect, it } from "vitest";
import {
  bboxArea,
  computeContainLayout,
  displayToOriginal,
  findSegmentAtPoint,
  maskToOriginal,
  originalToDisplay,
  originalToMask,
  padBbox,
  pointInBbox,
  pointInPolygon,
  segmentContainsPoint,
} from "@/lib/segmentation/coordinate-mapping";
import type { Segment } from "@/lib/segmentation/types";

function seg(id: string, x: number, y: number, w: number, h: number): Segment {
  return {
    id,
    label: id,
    score: null,
    bbox: { x, y, width: w, height: h },
    polygon: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    mask: null,
  };
}

describe("computeContainLayout", () => {
  it("fits a wide image with vertical letterboxing", () => {
    const layout = computeContainLayout(640, 480, 320, 320);
    expect(layout.scale).toBeCloseTo(0.5);
    expect(layout.displayWidth).toBeCloseTo(320);
    expect(layout.displayHeight).toBeCloseTo(240);
    expect(layout.offsetX).toBeCloseTo(0);
    expect(layout.offsetY).toBeCloseTo(40);
  });

  it("round-trips original <-> display coordinates", () => {
    const layout = computeContainLayout(640, 480, 320, 320);
    const display = originalToDisplay({ x: 64, y: 48 }, layout);
    expect(display).toEqual({ x: 32, y: 64 });
    const back = displayToOriginal(display, layout, 640, 480);
    expect(back?.x).toBeCloseTo(64);
    expect(back?.y).toBeCloseTo(48);
  });

  it("returns null for taps on letterbox padding", () => {
    const layout = computeContainLayout(640, 480, 320, 320);
    expect(displayToOriginal({ x: 160, y: 10 }, layout, 640, 480)).toBeNull();
    expect(displayToOriginal({ x: 160, y: 100 }, layout, 640, 480)).not.toBeNull();
  });

  it("rejects non-positive inputs", () => {
    expect(() => computeContainLayout(0, 480, 320, 320)).toThrow();
  });
});

describe("mask coordinate helpers", () => {
  it("maps between mask and original pixels", () => {
    expect(maskToOriginal({ x: 4, y: 4 }, 8, 8, 640, 480)).toEqual({ x: 320, y: 240 });
    expect(originalToMask({ x: 320, y: 240 }, 8, 8, 640, 480)).toEqual({ x: 4, y: 4 });
  });
});

describe("pointInPolygon / pointInBbox", () => {
  const triangle = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
  ];

  it("detects inside, outside, and on-edge points", () => {
    expect(pointInPolygon({ x: 2, y: 2 }, triangle)).toBe(true);
    expect(pointInPolygon({ x: 9, y: 9 }, triangle)).toBe(false);
    expect(pointInPolygon({ x: 5, y: 0 }, triangle)).toBe(true);
  });

  it("tests bbox inclusion", () => {
    expect(pointInBbox({ x: 5, y: 5 }, { x: 0, y: 0, width: 10, height: 10 })).toBe(true);
    expect(pointInBbox({ x: 11, y: 5 }, { x: 0, y: 0, width: 10, height: 10 })).toBe(false);
    expect(bboxArea({ x: 0, y: 0, width: 10, height: 10 })).toBe(100);
  });
});

describe("segmentContainsPoint with decoded masks", () => {
  it("uses the bitmap when provided", () => {
    const s: Segment = {
      ...seg("m", 0, 0, 100, 100),
      polygon: null,
      mask: { width: 2, height: 2, encoding: "rle", data: "3,1", origin: null },
    };
    const decoded = Uint8Array.from([0, 0, 0, 1]);
    // Bottom-right quadrant is foreground in a 100x100 image.
    expect(segmentContainsPoint(s, { x: 75, y: 75 }, 100, 100, decoded)).toBe(true);
    expect(segmentContainsPoint(s, { x: 25, y: 25 }, 100, 100, decoded)).toBe(false);
  });

  it("maps box-cropped masks within their origin", () => {
    const s: Segment = {
      ...seg("c", 50, 50, 100, 100),
      polygon: null,
      mask: { width: 2, height: 2, encoding: "rle", data: "3,1", origin: { x: 50, y: 50 } },
    };
    const decoded = Uint8Array.from([0, 0, 0, 1]);
    // Bottom-right quadrant of the 100x100 box at (50,50) is foreground.
    expect(segmentContainsPoint(s, { x: 125, y: 125 }, 200, 200, decoded)).toBe(true);
    expect(segmentContainsPoint(s, { x: 60, y: 60 }, 200, 200, decoded)).toBe(false);
    expect(segmentContainsPoint(s, { x: 10, y: 10 }, 200, 200, decoded)).toBe(false);
  });

  it("falls back to polygon, then bbox", () => {
    const poly = seg("p", 0, 0, 100, 100);
    expect(segmentContainsPoint(poly, { x: 50, y: 50 }, 100, 100)).toBe(true);
    const boxOnly: Segment = { ...poly, polygon: null };
    expect(segmentContainsPoint(boxOnly, { x: 50, y: 50 }, 100, 100)).toBe(true);
    expect(segmentContainsPoint(boxOnly, { x: 150, y: 50 }, 100, 100)).toBe(false);
  });
});

describe("findSegmentAtPoint", () => {
  it("prefers the smallest containing region on overlap", () => {
    const outer = seg("outer", 0, 0, 100, 100);
    const inner = seg("inner", 25, 25, 50, 50);
    expect(findSegmentAtPoint([outer, inner], { x: 50, y: 50 }, 100, 100)?.id).toBe("inner");
    expect(findSegmentAtPoint([outer, inner], { x: 10, y: 10 }, 100, 100)?.id).toBe("outer");
    expect(findSegmentAtPoint([outer, inner], { x: 150, y: 150 }, 100, 100)).toBeNull();
  });

  it("keeps order on ties", () => {
    const a = seg("a", 0, 0, 50, 50);
    const b = seg("b", 0, 0, 50, 50);
    expect(findSegmentAtPoint([a, b], { x: 10, y: 10 }, 100, 100)?.id).toBe("a");
  });
});

describe("padBbox", () => {
  it("expands and clamps to image bounds", () => {
    expect(padBbox({ x: 0, y: 0, width: 100, height: 100 }, 200, 200, 0.1)).toEqual({
      x: 0,
      y: 0,
      width: 110,
      height: 110,
    });
    const padded = padBbox({ x: 50, y: 50, width: 100, height: 100 }, 200, 200, 0.1);
    expect(padded.x).toBeCloseTo(40);
    expect(padded.width).toBeCloseTo(120);
  });
});
