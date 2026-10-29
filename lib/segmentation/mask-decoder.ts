import type { EncodedMask } from "./types";

export class MaskDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaskDecodeError";
  }
}

/** Decode a base64 string to bytes. Throws MaskDecodeError on invalid input. */
export function decodeBase64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  if (clean.length === 0) return new Uint8Array(0);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 !== 0) {
    throw new MaskDecodeError("Invalid base64 payload");
  }
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Decode Adobe Ascii85 ("Base85") to bytes.
 * Supports the 'z' shorthand for four zero bytes. Whitespace is ignored.
 * Throws MaskDecodeError on invalid input.
 */
export function decodeAscii85ToBytes(input: string): Uint8Array {
  // Strip optional Adobe <~ ~> framing.
  let s = input.replace(/\s+/g, "");
  if (s.startsWith("<~")) s = s.slice(2);
  if (s.endsWith("~>")) s = s.slice(0, -2);

  const out: number[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "z") {
      out.push(0, 0, 0, 0);
      i += 1;
      continue;
    }
    const chunk = s.slice(i, i + 5);
    if (!/^[\x21-\x75]+$/.test(chunk)) {
      throw new MaskDecodeError(`Invalid Ascii85 character near offset ${i}`);
    }
    const n = chunk.length;
    if (n === 1) {
      throw new MaskDecodeError("Invalid final Ascii85 group of length 1");
    }
    const padded = n < 5 ? chunk + "u".repeat(5 - n) : chunk;
    let value = 0;
    for (const c of padded) value = value * 85 + (c.charCodeAt(0) - 33);
    if (value > 0xffffffff) {
      throw new MaskDecodeError(`Ascii85 group overflow near offset ${i}`);
    }
    const bytes = [
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ];
    // A final short group of length n yields n-1 bytes.
    const take = n < 5 ? n - 1 : 4;
    for (let k = 0; k < take; k++) out.push(bytes[k]);
    i += n;
  }
  return Uint8Array.from(out);
}

/**
 * Unpack 1-bit-per-pixel row-major bytes (MSB first) into a 0/1 mask.
 * Each row occupies ceil(width / 8) bytes.
 */
export function unpackBitmask(bytes: Uint8Array, width: number, height: number): Uint8Array {
  assertDimensions(width, height);
  const stride = Math.ceil(width / 8);
  if (bytes.length < stride * height) {
    throw new MaskDecodeError(
      `Bitmap too short: need ${stride * height} bytes for ${width}x${height}, got ${bytes.length}`,
    );
  }
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const byte = bytes[y * stride + (x >> 3)];
      mask[y * width + x] = (byte >> (7 - (x & 7))) & 1;
    }
  }
  return mask;
}

/** Normalize 1-byte-per-pixel data into a 0/1 mask. */
export function unpackByteMask(bytes: Uint8Array, width: number, height: number): Uint8Array {
  assertDimensions(width, height);
  if (bytes.length < width * height) {
    throw new MaskDecodeError(
      `Mask too short: need ${width * height} bytes for ${width}x${height}, got ${bytes.length}`,
    );
  }
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = bytes[i] === 0 ? 0 : 1;
  return mask;
}

/**
 * Decode COCO-style run-length counts (starting with background zeros)
 * over row-major pixels into a 0/1 mask.
 */
export function decodeRleToMask(counts: number[], width: number, height: number): Uint8Array {
  assertDimensions(width, height);
  const total = width * height;
  const mask = new Uint8Array(total);
  let pos = 0;
  let value = 0;
  for (const count of counts) {
    if (!Number.isInteger(count) || count < 0) {
      throw new MaskDecodeError("RLE counts must be non-negative integers");
    }
    if (pos + count > total) {
      throw new MaskDecodeError("RLE counts exceed mask dimensions");
    }
    if (value === 1) mask.fill(1, pos, pos + count);
    pos += count;
    value = 1 - value;
  }
  if (pos !== total) {
    throw new MaskDecodeError(`RLE counts cover ${pos} pixels, expected ${total}`);
  }
  return mask;
}

/** Parse an RLE payload string ("1,2,3" or "1 2 3") into counts. */
export function parseRlePayload(data: string): number[] {
  const tokens = data.split(/[\s,]+/).filter((t) => t.length > 0);
  const counts = tokens.map((t) => Number(t));
  if (counts.some((c) => !Number.isFinite(c))) {
    throw new MaskDecodeError("RLE payload contains non-numeric counts");
  }
  return counts;
}

/**
 * Decode any supported EncodedMask into a 0/1 row-major mask of
 * width * height entries.
 */
export function decodeSegmentMask(mask: EncodedMask): Uint8Array {
  switch (mask.encoding) {
    case "base64-bitmap":
      return unpackBitmask(decodeBase64ToBytes(mask.data), mask.width, mask.height);
    case "base64-bytes":
      return unpackByteMask(decodeBase64ToBytes(mask.data), mask.width, mask.height);
    case "base85-bitmap":
      return unpackBitmask(decodeAscii85ToBytes(mask.data), mask.width, mask.height);
    case "base85-bytes":
      return unpackByteMask(decodeAscii85ToBytes(mask.data), mask.width, mask.height);
    case "rle":
      return decodeRleToMask(parseRlePayload(mask.data), mask.width, mask.height);
    default:
      throw new MaskDecodeError(`Unsupported mask encoding: ${(mask as EncodedMask).encoding}`);
  }
}

/**
 * Pack a 0/1 row-major raster into base64 bitmask form (1 bit per pixel,
 * row-major, MSB first) matching the "base64-bitmap" encoding. Works in
 * browsers and Node (uses global btoa).
 */
export function packBitmaskToBase64(raster: Uint8Array, width: number, height: number): string {
  assertDimensions(width, height);
  if (raster.length !== width * height) {
    throw new MaskDecodeError(
      `Raster has ${raster.length} entries, expected ${width * height}`,
    );
  }
  const stride = Math.ceil(width / 8);
  const bytes = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (raster[y * width + x] === 1) {
        bytes[y * stride + (x >> 3)] |= 1 << (7 - (x & 7));
      }
    }
  }
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Count foreground pixels in a decoded mask. */
export function maskForegroundCount(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] === 1) n++;
  return n;
}

function assertDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new MaskDecodeError(`Invalid mask dimensions: ${width}x${height}`);
  }
  if (width * height > 100_000_000) {
    throw new MaskDecodeError(`Mask dimensions too large: ${width}x${height}`);
  }
}
