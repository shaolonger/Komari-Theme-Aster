import { useCallback, useState, type SetStateAction } from 'react';
import { normalizeThemeSettings, type ResolvedThemeSettings } from '@/utils/themeSettings';

function createStudioDraft(next: ResolvedThemeSettings) {
  return {
    draftAppearance: next.defaultAppearance,
    draftDisplayTimeZoneText: next.displayTimeZone,
    draftDesktopNodeViewMode: next.desktopNodeViewMode,
    draftMobileNodeViewMode: next.mobileNodeViewMode,
    draftBindings: next.homepagePingBindings,
    draftPingTaskOrder: next.homepagePingTaskOrder,
    draftPingAggregationStrategy: next.homepagePingAggregationStrategy,
    draftPingPrimaryTasks: next.homepagePingPrimaryTasks,
    draftPingTaskGroups: next.homepagePingTaskGroups,
    draftShowHomeOverview: next.showHomeOverview,
    draftShowGroupTabs: next.showGroupTabs,
    draftHomeGroupOrder: next.homeGroupOrder,
    draftFacetDimensions: next.homeFacetDimensions,
    draftHomeNodeFacets: next.homeNodeFacets,
    draftHomeDefaultFacetDimension: next.homeDefaultFacetDimension,
    draftHomeSelectedNodeUuids: next.homeSelectedNodeUuids,
    draftHomeSavedViews: next.homeSavedViews,
    draftHomeDefaultSavedViewId: next.homeDefaultSavedViewId,
    draftMoveOfflineNodesBack: next.moveOfflineNodesBack,
    draftShowCostSummary: next.showCostSummary,
    draftShowCostSummaryFloatingButton: next.showCostSummaryFloatingButton,
    draftShowOverviewRatings: next.showOverviewRatings,
    draftOverviewRatingStyle: next.overviewRatingStyle,
    draftShowTrafficRating: next.showTrafficRating,
    draftShowBandwidthRating: next.showBandwidthRating,
    draftShowAssetRating: next.showAssetRating,
    draftRatingLabels: {
      traffic: next.trafficRatingLabels,
      bandwidth: next.bandwidthRatingLabels,
      asset: next.assetRatingLabels,
    },
    draftCompactShowTrafficTotal: next.compactShowTrafficTotal,
    draftCompactShowBilling: next.compactShowBilling,
    draftCompactShowUptime: next.compactShowUptime,
    draftShowConnections: next.showConnections,
    draftCostIgnoredText: next.costIgnoredNodes.join("\n"),
    draftCostRateApiUrl: next.costRateApiUrl,
    draftBackgroundImage: next.backgroundImage,
    draftBackgroundImageMobile: next.backgroundImageMobile,
    draftBackgroundAlignment: next.backgroundAlignment,
    draftSurfaceOpacity: next.surfaceOpacity,
  };
}

type StudioDraft = ReturnType<typeof createStudioDraft>;

export function useStudioDraft() {
  const [draft, setDraft] = useState(() => createStudioDraft(normalizeThemeSettings({})));
  const seedDrafts = useCallback((next: ResolvedThemeSettings) => setDraft(createStudioDraft(next)), []);
  function update<K extends keyof StudioDraft>(key: K, action: SetStateAction<StudioDraft[K]>) {
    setDraft(previous => ({ ...previous, [key]: typeof action === 'function' ? (action as (value: StudioDraft[K]) => StudioDraft[K])(previous[key]) : action }));
  }
  return { ...draft, seedDrafts,
    setDraftAppearance: (action: SetStateAction<StudioDraft["draftAppearance"]>) => update("draftAppearance", action),
    setDraftDisplayTimeZoneText: (action: SetStateAction<StudioDraft["draftDisplayTimeZoneText"]>) => update("draftDisplayTimeZoneText", action),
    setDraftDesktopNodeViewMode: (action: SetStateAction<StudioDraft["draftDesktopNodeViewMode"]>) => update("draftDesktopNodeViewMode", action),
    setDraftMobileNodeViewMode: (action: SetStateAction<StudioDraft["draftMobileNodeViewMode"]>) => update("draftMobileNodeViewMode", action),
    setDraftBindings: (action: SetStateAction<StudioDraft["draftBindings"]>) => update("draftBindings", action),
    setDraftPingTaskOrder: (action: SetStateAction<StudioDraft["draftPingTaskOrder"]>) => update("draftPingTaskOrder", action),
    setDraftPingAggregationStrategy: (action: SetStateAction<StudioDraft["draftPingAggregationStrategy"]>) => update("draftPingAggregationStrategy", action),
    setDraftPingPrimaryTasks: (action: SetStateAction<StudioDraft["draftPingPrimaryTasks"]>) => update("draftPingPrimaryTasks", action),
    setDraftPingTaskGroups: (action: SetStateAction<StudioDraft["draftPingTaskGroups"]>) => update("draftPingTaskGroups", action),
    setDraftShowHomeOverview: (action: SetStateAction<StudioDraft["draftShowHomeOverview"]>) => update("draftShowHomeOverview", action),
    setDraftShowGroupTabs: (action: SetStateAction<StudioDraft["draftShowGroupTabs"]>) => update("draftShowGroupTabs", action),
    setDraftHomeGroupOrder: (action: SetStateAction<StudioDraft["draftHomeGroupOrder"]>) => update("draftHomeGroupOrder", action),
    setDraftFacetDimensions: (action: SetStateAction<StudioDraft["draftFacetDimensions"]>) => update("draftFacetDimensions", action),
    setDraftHomeNodeFacets: (action: SetStateAction<StudioDraft["draftHomeNodeFacets"]>) => update("draftHomeNodeFacets", action),
    setDraftHomeDefaultFacetDimension: (action: SetStateAction<StudioDraft["draftHomeDefaultFacetDimension"]>) => update("draftHomeDefaultFacetDimension", action),
    setDraftHomeSelectedNodeUuids: (action: SetStateAction<StudioDraft["draftHomeSelectedNodeUuids"]>) => update("draftHomeSelectedNodeUuids", action),
    setDraftHomeSavedViews: (action: SetStateAction<StudioDraft["draftHomeSavedViews"]>) => update("draftHomeSavedViews", action),
    setDraftHomeDefaultSavedViewId: (action: SetStateAction<StudioDraft["draftHomeDefaultSavedViewId"]>) => update("draftHomeDefaultSavedViewId", action),
    setDraftMoveOfflineNodesBack: (action: SetStateAction<StudioDraft["draftMoveOfflineNodesBack"]>) => update("draftMoveOfflineNodesBack", action),
    setDraftShowCostSummary: (action: SetStateAction<StudioDraft["draftShowCostSummary"]>) => update("draftShowCostSummary", action),
    setDraftShowCostSummaryFloatingButton: (action: SetStateAction<StudioDraft["draftShowCostSummaryFloatingButton"]>) => update("draftShowCostSummaryFloatingButton", action),
    setDraftShowOverviewRatings: (action: SetStateAction<StudioDraft["draftShowOverviewRatings"]>) => update("draftShowOverviewRatings", action),
    setDraftOverviewRatingStyle: (action: SetStateAction<StudioDraft["draftOverviewRatingStyle"]>) => update("draftOverviewRatingStyle", action),
    setDraftShowTrafficRating: (action: SetStateAction<StudioDraft["draftShowTrafficRating"]>) => update("draftShowTrafficRating", action),
    setDraftShowBandwidthRating: (action: SetStateAction<StudioDraft["draftShowBandwidthRating"]>) => update("draftShowBandwidthRating", action),
    setDraftShowAssetRating: (action: SetStateAction<StudioDraft["draftShowAssetRating"]>) => update("draftShowAssetRating", action),
    setDraftRatingLabels: (action: SetStateAction<StudioDraft["draftRatingLabels"]>) => update("draftRatingLabels", action),
    setDraftCompactShowTrafficTotal: (action: SetStateAction<StudioDraft["draftCompactShowTrafficTotal"]>) => update("draftCompactShowTrafficTotal", action),
    setDraftCompactShowBilling: (action: SetStateAction<StudioDraft["draftCompactShowBilling"]>) => update("draftCompactShowBilling", action),
    setDraftCompactShowUptime: (action: SetStateAction<StudioDraft["draftCompactShowUptime"]>) => update("draftCompactShowUptime", action),
    setDraftShowConnections: (action: SetStateAction<StudioDraft["draftShowConnections"]>) => update("draftShowConnections", action),
    setDraftCostIgnoredText: (action: SetStateAction<StudioDraft["draftCostIgnoredText"]>) => update("draftCostIgnoredText", action),
    setDraftCostRateApiUrl: (action: SetStateAction<StudioDraft["draftCostRateApiUrl"]>) => update("draftCostRateApiUrl", action),
    setDraftBackgroundImage: (action: SetStateAction<StudioDraft["draftBackgroundImage"]>) => update("draftBackgroundImage", action),
    setDraftBackgroundImageMobile: (action: SetStateAction<StudioDraft["draftBackgroundImageMobile"]>) => update("draftBackgroundImageMobile", action),
    setDraftBackgroundAlignment: (action: SetStateAction<StudioDraft["draftBackgroundAlignment"]>) => update("draftBackgroundAlignment", action),
    setDraftSurfaceOpacity: (action: SetStateAction<StudioDraft["draftSurfaceOpacity"]>) => update("draftSurfaceOpacity", action),
  };
}
