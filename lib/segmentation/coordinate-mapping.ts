import type { BoundingBox, Point, Segment } from "./types";

/**
 * Layout of an image rendered with `object-fit: contain` inside a container.
 * All values are CSS pixels.
 */
export interface ContainLayout {
  /** Scale factor from original image pixels to displayed pixels. */
  scale: number;
  /** Horizontal letterbox offset of the image inside the container. */
  offsetX: number;
  /** Vertical letterbox offset of the image inside the container. */
  offsetY: number;
  displayWidth: number;
  displayHeight: number;
}

/**
 * Compute how an image of natural size fits (contain) into a container.
 * Throws on non-positive inputs.
 */
export function computeContainLayout(
  naturalWidth: number,
  naturalHeight: number,
  containerWidth: number,
  containerHeight: number,
): ContainLayout {
  for (const [name, v] of [
    ["naturalWidth", naturalWidth],
    ["naturalHeight", naturalHeight],
    ["containerWidth", containerWidth],
    ["containerHeight", containerHeight],
  ] as const) {
    if (!Number.isFinite(v) || v <= 0) {
      throw new Error(`computeContainLayout: ${name} must be positive, got ${v}`);
    }
  }
  const scale = Math.min(containerWidth / naturalWidth, containerHeight / naturalHeight);
  const displayWidth = naturalWidth * scale;
  const displayHeight = naturalHeight * scale;
  return {
    scale,
    offsetX: (containerWidth - displayWidth) / 2,
    offsetY: (containerHeight - displayHeight) / 2,
    displayWidth,
    displayHeight,
  };
}

/** Original image pixels -> container CSS pixels. */
export function originalToDisplay(p: Point, layout: ContainLayout): Point {
  return { x: layout.offsetX + p.x * layout.scale, y: layout.offsetY + p.y * layout.scale };
}

/**
 * Container CSS pixels (e.g. pointer position relative to the overlay box)
 * -> original image pixels. Returns null when the point lands on letterbox
 * padding outside the displayed image.
 */
export function displayToOriginal(
  p: Point,
  layout: ContainLayout,
  naturalWidth: number,
  naturalHeight: number,
): Point | null {
  const x = (p.x - layout.offsetX) / layout.scale;
  const y = (p.y - layout.offsetY) / layout.scale;
  if (x < 0 || y < 0 || x > naturalWidth || y > naturalHeight) return null;
  return { x, y };
}

/** Mask pixel coordinates -> original image pixels (masks may be low-res). */
export function maskToOriginal(
  p: Point,
  maskWidth: number,
  maskHeight: number,
  imageWidth: number,
  imageHeight: number,
): Point {
  return { x: (p.x / maskWidth) * imageWidth, y: (p.y / maskHeight) * imageHeight };
}

/** Original image pixels -> mask pixel coordinates (rounded down). */
export function originalToMask(
  p: Point,
  maskWidth: number,
  maskHeight: number,
  imageWidth: number,
  imageHeight: number,
): Point {
  return {
    x: Math.floor((p.x / imageWidth) * maskWidth),
    y: Math.floor((p.y / imageHeight) * maskHeight),
  };
}

/** Ray-casting point-in-polygon test. Points on edges count as inside. */
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (pointOnSegment(p, a, b)) return true;
    if (a.y > p.y !== b.y > p.y) {
      const xHit = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < xHit) inside = !inside;
    }
  }
  return inside;
}

function pointOnSegment(p: Point, a: Point, b: Point): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const lenSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y) < 1e-9;
  if (Math.abs(cross) / Math.sqrt(lenSq) > 1e-9) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  return dot >= 0 && dot <= lenSq;
}

export function pointInBbox(p: Point, bbox: BoundingBox): boolean {
  return (
    p.x >= bbox.x && p.x <= bbox.x + bbox.width && p.y >= bbox.y && p.y <= bbox.y + bbox.height
  );
}

export function bboxArea(bbox: BoundingBox): number {
  return Math.max(0, bbox.width) * Math.max(0, bbox.height);
}

/**
 * Hit-test helper: does the original-image point fall inside the segment?
 * `decodedMask` is an optional pre-decoded 0/1 row-major bitmap for
 * segment.mask (mask.width * mask.height entries) in original-image space
 * mapping via segment.mask dimensions and the full image size.
 */
export function segmentContainsPoint(
  segment: Segment,
  p: Point,
  imageWidth: number,
  imageHeight: number,
  decodedMask?: Uint8Array | null,
): boolean {
  if (decodedMask && segment.mask) {
    const mw = segment.mask.width;
    const mh = segment.mask.height;
    let mx: number;
    let my: number;
    if (segment.mask.origin) {
      // Box-cropped raster (SAM 3.1): map within the bbox region.
      if (segment.bbox.width <= 0 || segment.bbox.height <= 0) return false;
      mx = Math.floor(((p.x - segment.mask.origin.x) / segment.bbox.width) * mw);
      my = Math.floor(((p.y - segment.mask.origin.y) / segment.bbox.height) * mh);
    } else {
      const m = originalToMask(p, mw, mh, imageWidth, imageHeight);
      mx = m.x;
      my = m.y;
    }
    if (mx < 0 || my < 0 || mx >= mw || my >= mh) return false;
    return decodedMask[my * mw + mx] === 1;
  }
  if (segment.polygon && segment.polygon.length >= 3) {
    return pointInPolygon(p, segment.polygon);
  }
  return pointInBbox(p, segment.bbox);
}

export type DecodedMaskCache = Map<string, Uint8Array | null>;

/**
 * Find the best segment containing the original-image point.
 * Rule: among containing segments, pick the smallest bbox area (most
 * specific region); ties keep the earlier segment order (topmost first).
 */
export function findSegmentAtPoint(
  segments: Segment[],
  p: Point,
  imageWidth: number,
  imageHeight: number,
  masks?: DecodedMaskCache,
): Segment | null {
  let best: Segment | null = null;
  let bestArea = Infinity;
  for (const seg of segments) {
    const decoded = masks?.get(seg.id) ?? null;
    if (!segmentContainsPoint(seg, p, imageWidth, imageHeight, decoded)) continue;
    const area = bboxArea(seg.bbox);
    if (area < bestArea) {
      best = seg;
      bestArea = area;
    }
  }
  return best;
}

/**
 * Expand a bbox by a padding fraction (of its own size) and clamp to the
 * image bounds. Used to build the explanation crop.
 */
export function padBbox(bbox: BoundingBox, imageWidth: number, imageHeight: number, fraction = 0.12): BoundingBox {
  const padX = bbox.width * fraction;
  const padY = bbox.height * fraction;
  const x = Math.max(0, bbox.x - padX);
  const y = Math.max(0, bbox.y - padY);
  const right = Math.min(imageWidth, bbox.x + bbox.width + padX);
  const bottom = Math.min(imageHeight, bbox.y + bbox.height + padY);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}
