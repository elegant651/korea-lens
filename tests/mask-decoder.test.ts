import { describe, expect, it } from "vitest";
import {
  decodeAscii85ToBytes,
  decodeBase64ToBytes,
  decodeRleToMask,
  decodeSegmentMask,
  maskForegroundCount,
  MaskDecodeError,
  packBitmaskToBase64,
  parseRlePayload,
  unpackBitmask,
  unpackByteMask,
} from "@/lib/segmentation/mask-decoder";

describe("decodeBase64ToBytes", () => {
  it("decodes standard base64", () => {
    expect(Array.from(decodeBase64ToBytes("AP8A/w=="))).toEqual([0x00, 0xff, 0x00, 0xff]);
  });

  it("rejects invalid base64", () => {
    expect(() => decodeBase64ToBytes("!!!")).toThrow(MaskDecodeError);
    expect(() => decodeBase64ToBytes("abc")).toThrow(MaskDecodeError);
  });
});

describe("decodeAscii85ToBytes", () => {
  it("decodes the Wikipedia example", () => {
    // "Man is distinguished ..." example prefix: "Man " === "9jqo^".
    const bytes = decodeAscii85ToBytes("9jqo^");
    expect(Array.from(bytes)).toEqual([0x4d, 0x61, 0x6e, 0x20]);
  });

  it("supports z shorthand, whitespace, and Adobe framing", () => {
    expect(Array.from(decodeAscii85ToBytes("z"))).toEqual([0, 0, 0, 0]);
    expect(Array.from(decodeAscii85ToBytes("<~ 9jqo^ ~>"))).toEqual([0x4d, 0x61, 0x6e, 0x20]);
  });

  it("decodes a final short group to n-1 bytes", () => {
    // "!!" (n=2) -> 1 byte.
    expect(decodeAscii85ToBytes("!!")).toHaveLength(1);
  });

  it("rejects invalid groups", () => {
    expect(() => decodeAscii85ToBytes("x")).toThrow(MaskDecodeError);
    expect(() => decodeAscii85ToBytes("~~~~~")).toThrow(MaskDecodeError);
  });
});

describe("unpackBitmask", () => {
  it("unpacks MSB-first rows with stride padding", () => {
    // 10x1: bits 10000000 10000000 -> x=0 and x=8 set.
    const mask = unpackBitmask(Uint8Array.from([0x80, 0x80]), 10, 1);
    expect(mask[0]).toBe(1);
    expect(mask[8]).toBe(1);
    expect(maskForegroundCount(mask)).toBe(2);
  });

  it("rejects short buffers", () => {
    expect(() => unpackBitmask(Uint8Array.from([0xff]), 16, 1)).toThrow(MaskDecodeError);
  });
});

describe("unpackByteMask", () => {
  it("normalizes nonzero bytes to 1", () => {
    const mask = unpackByteMask(Uint8Array.from([0, 7, 255, 0]), 2, 2);
    expect(Array.from(mask)).toEqual([0, 1, 1, 0]);
  });

  it("rejects short buffers", () => {
    expect(() => unpackByteMask(Uint8Array.from([1]), 2, 2)).toThrow(MaskDecodeError);
  });
});

describe("decodeRleToMask", () => {
  it("decodes counts starting with background", () => {
    const mask = decodeRleToMask([2, 2], 2, 2);
    expect(Array.from(mask)).toEqual([0, 0, 1, 1]);
  });

  it("parses comma- and space-separated payloads", () => {
    expect(parseRlePayload("2, 2")).toEqual([2, 2]);
    expect(parseRlePayload("2 2")).toEqual([2, 2]);
    expect(() => parseRlePayload("2, x")).toThrow(MaskDecodeError);
  });

  it("rejects counts that do not cover the mask exactly", () => {
    expect(() => decodeRleToMask([1], 2, 2)).toThrow(MaskDecodeError);
    expect(() => decodeRleToMask([5], 2, 2)).toThrow(MaskDecodeError);
    expect(() => decodeRleToMask([-1, 5], 2, 2)).toThrow(MaskDecodeError);
  });
});

describe("decodeSegmentMask", () => {
  it("dispatches on encoding", () => {
    const bitmap = decodeSegmentMask({
      width: 8,
      height: 1,
      encoding: "base64-bitmap",
      data: "gA==", // 0x80
      origin: null,
    });
    expect(bitmap[0]).toBe(1);
    expect(maskForegroundCount(bitmap)).toBe(1);

    const bytes = decodeSegmentMask({
      width: 2,
      height: 1,
      encoding: "base64-bytes",
      data: "AAE=",
      origin: null,
    });
    expect(Array.from(bytes)).toEqual([0, 1]);

    const rle = decodeSegmentMask({ width: 2, height: 2, encoding: "rle", data: "1,3", origin: null });
    expect(Array.from(rle)).toEqual([0, 1, 1, 1]);

    const z85 = decodeSegmentMask({
      width: 4,
      height: 1,
      encoding: "base85-bitmap",
      data: "z",
      origin: null,
    });
    expect(maskForegroundCount(z85)).toBe(0);
  });

  it("rejects unknown encodings", () => {
    expect(() =>
      decodeSegmentMask({ width: 1, height: 1, encoding: "coco" as never, data: "x", origin: null }),
    ).toThrow(MaskDecodeError);
  });

  it("packs rasters with stride padding", () => {
    const packed = packBitmaskToBase64(Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 1]), 10, 1);
    expect(Array.from(unpackBitmask(decodeBase64ToBytes(packed), 10, 1))).toEqual([
      1, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ]);
  });

  it("round-trips through decodeSegmentMask", () => {
    const raster = Uint8Array.from([0, 1, 1, 0, 1, 0]);
    const data = packBitmaskToBase64(raster, 3, 2);
    const decoded = decodeSegmentMask({
      width: 3,
      height: 2,
      encoding: "base64-bitmap",
      data,
      origin: null,
    });
    expect(Array.from(decoded)).toEqual(Array.from(raster));
  });

  it("rejects rasters of the wrong length", () => {
    expect(() => packBitmaskToBase64(Uint8Array.from([1]), 2, 2)).toThrow(MaskDecodeError);
  });
});
