import { describe, expect, it } from "vitest";
import { reorderById } from "@/components/settings/dragReorder";

describe("drag reorder", () => {
  it("moves a dragged item to the target position without mutating the input", () => {
    const source = [1, 2, 3, 4];
    expect(reorderById(source, 4, 2)).toEqual([1, 4, 2, 3]);
    expect(source).toEqual([1, 2, 3, 4]);
  });

  it("returns the original array for unknown and unchanged targets", () => {
    const source = ["a", "b"];
    expect(reorderById(source, "a", "a")).toBe(source);
    expect(reorderById(source, "a", "missing")).toBe(source);
  });
});
