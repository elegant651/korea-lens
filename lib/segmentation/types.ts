/** Internal normalized segmentation types for KoreaLens. */

export interface Point {
  x: number;
  y: number;
}

/** Bounding box in original image pixel coordinates. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MaskEncoding =
  | "base64-bitmap" // raw bytes, 1 bit per pixel, row-major, MSB first
  | "base64-bytes" // raw bytes, 1 byte per pixel (0 = background, nonzero = foreground)
  | "base85-bitmap" // Ascii85-encoded bytes, 1 bit per pixel, row-major, MSB first
  | "base85-bytes" // Ascii85-encoded bytes, 1 byte per pixel
  | "rle"; // COCO-style run-length counts (starting with background) over row-major pixels

export interface EncodedMask {
  width: number;
  height: number;
  encoding: MaskEncoding;
  /** Encoded payload: base64/base85 string, or comma/space separated counts for rle. */
  data: string;
  /**
   * Top-left of the raster in original image pixels. SAM 3.1 masks are
   * cropped to their box (origin = box top-left); null means the raster
   * covers the full image.
   */
  origin: Point | null;
}

/**
 * A single segmented object candidate.
 * Coordinates in `bbox` and `polygon` are original image pixels.
 */
export interface Segment {
  /** Stable ID within the current analysis result. */
  id: string;
  label: string | null;
  /** Model confidence in [0, 1] when provided. */
  score: number | null;
  bbox: BoundingBox;
  /** Polygon outline in original image pixels, when available. */
  polygon: Point[] | null;
  /** Bitmap mask, when available. */
  mask: EncodedMask | null;
}

export interface SegmentationResult {
  segments: Segment[];
  imageWidth: number;
  imageHeight: number;
}
