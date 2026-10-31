import { describe, expect, it } from "vitest";
import { computeTargetDimensions, MAX_UPLOAD_DIM } from "@/lib/client/image";

describe("computeTargetDimensions", () => {
  it("leaves small images untouched", () => {
    expect(computeTargetDimensions(640, 480)).toEqual({ width: 640, height: 480 });
    expect(computeTargetDimensions(MAX_UPLOAD_DIM, 100)).toEqual({
      width: MAX_UPLOAD_DIM,
      height: 100,
    });
  });

  it("scales the long side down to the limit, preserving aspect ratio", () => {
    // 4000x3000 phone photo -> 1600x1200.
    expect(computeTargetDimensions(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    // Portrait orientation.
    expect(computeTargetDimensions(3000, 4000)).toEqual({ width: 1200, height: 1600 });
  });

  it("honors a custom limit", () => {
    expect(computeTargetDimensions(4000, 3000, 1024)).toEqual({ width: 1024, height: 768 });
  });

  it("rejects invalid dimensions", () => {
    expect(() => computeTargetDimensions(0, 100)).toThrow();
    expect(() => computeTargetDimensions(100, -1)).toThrow();
  });
});
