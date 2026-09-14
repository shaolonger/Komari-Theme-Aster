import { describe, expect, it } from "vitest";
import { canvasBackingSize } from "@/components/node/CanvasStrip";

describe("CanvasStrip backing store budget", () => {
  it("caps high-density canvases at 2x while preserving CSS pixels", () => {
    expect(canvasBackingSize(360, 40, 4)).toEqual({ dpr: 2, width: 720, height: 80 });
    expect(canvasBackingSize(360, 40, 1.5)).toEqual({ dpr: 1.5, width: 540, height: 60 });
  });

  it("normalizes invalid and sub-1 DPR values", () => {
    expect(canvasBackingSize(0, 0, Number.NaN)).toEqual({ dpr: 1, width: 1, height: 1 });
    expect(canvasBackingSize(100, 20, 0.5)).toEqual({ dpr: 1, width: 100, height: 20 });
  });
});
