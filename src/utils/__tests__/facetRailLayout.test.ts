import { describe, expect, it } from "vitest";
import { fitFacetQuickOptionCount } from "@/utils/facetRailLayout";

const base = {
  contentWidth: 500,
  dimensionWidth: 100,
  noFilterWidth: 50,
  railGap: 4,
  optionGap: 3,
  optionWidths: [60, 70, 80],
  moreWidths: [58, 62, 66],
};

describe("facet rail layout", () => {
  it("shows every option when the complete row fits", () => {
    expect(fitFacetQuickOptionCount(base)).toBe(3);
  });

  it("reserves the measured More control only when options overflow", () => {
    expect(
      fitFacetQuickOptionCount({
        ...base,
        contentWidth: 304,
      }),
    ).toBe(1);
  });

  it("uses the real More count width when finding the largest fitting prefix", () => {
    expect(
      fitFacetQuickOptionCount({
        ...base,
        contentWidth: 354,
        moreWidths: [90, 62, 66],
      }),
    ).toBe(1);
  });

  it("falls back to the More menu when no quick option fits", () => {
    expect(
      fitFacetQuickOptionCount({
        ...base,
        contentWidth: 220,
      }),
    ).toBe(0);
  });

  it("treats invalid measurements as zero instead of producing NaN", () => {
    expect(
      fitFacetQuickOptionCount({
        ...base,
        contentWidth: Number.NaN,
      }),
    ).toBe(0);
  });
});
