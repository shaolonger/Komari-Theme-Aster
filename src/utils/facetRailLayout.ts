export interface FacetRailFitInput {
  contentWidth: number;
  dimensionWidth: number;
  noFilterWidth: number;
  railGap: number;
  optionGap: number;
  optionWidths: number[];
  moreWidths: number[];
}

function nonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Returns the largest prefix of facet options that fits in the rail.
 *
 * `moreWidths[index]` is the measured width of the “更多 +N” control for
 * `N = index + 1`. Measuring every possible label keeps the decision tied to
 * the real rendered font instead of reserving a hard-coded or worst-case slot.
 */
export function fitFacetQuickOptionCount(input: FacetRailFitInput) {
  const contentWidth = nonNegative(input.contentWidth);
  const dimensionWidth = nonNegative(input.dimensionWidth);
  const noFilterWidth = nonNegative(input.noFilterWidth);
  const railGap = nonNegative(input.railGap);
  const optionGap = nonNegative(input.optionGap);
  const optionWidths = input.optionWidths.map(nonNegative);
  const moreWidths = input.moreWidths.map(nonNegative);
  const optionCount = optionWidths.length;
  const prefixWidths = [0];

  for (const width of optionWidths) {
    prefixWidths.push(prefixWidths[prefixWidths.length - 1] + width);
  }

  for (let quickCount = optionCount; quickCount >= 0; quickCount -= 1) {
    const optionLaneWidth =
      noFilterWidth +
      prefixWidths[quickCount] +
      optionGap * quickCount;
    const overflowCount = optionCount - quickCount;
    const requiredWidth =
      overflowCount === 0
        ? dimensionWidth + railGap + optionLaneWidth
        : dimensionWidth +
          railGap +
          optionLaneWidth +
          railGap +
          (moreWidths[overflowCount - 1] ?? 0);

    // Fractional device pixels can otherwise make an exactly fitting item
    // oscillate in and out while the viewport is being resized.
    if (requiredWidth <= contentWidth + 0.5) return quickCount;
  }

  return 0;
}
