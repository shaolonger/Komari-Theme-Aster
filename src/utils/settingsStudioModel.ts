import type { ThemeSettings } from '@/types/komari';
import { normalizeThemeSettings, type ResolvedThemeSettings } from '@/utils/themeSettings';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]));
  return value;
}

export function pickManagedThemeSettings(settings: ResolvedThemeSettings): ThemeSettings {
  return {
    defaultAppearance: settings.defaultAppearance,
    displayTimeZone: settings.displayTimeZone,
    desktopNodeViewMode: settings.desktopNodeViewMode,
    mobileNodeViewMode: settings.mobileNodeViewMode,
    homepagePingBindings: settings.homepagePingBindings,
    homepagePingTaskOrder: settings.homepagePingTaskOrder,
    homepagePingAggregationStrategy: settings.homepagePingAggregationStrategy,
    homepagePingPrimaryTasks: settings.homepagePingPrimaryTasks,
    homepagePingTaskGroups: settings.homepagePingTaskGroups,
    showHomeOverview: settings.showHomeOverview,
    showGroupTabs: settings.showGroupTabs,
    homeGroupOrder: settings.homeGroupOrder,
    homeFacetDimensions: settings.homeFacetDimensions,
    homeNodeFacets: settings.homeNodeFacets,
    homeDefaultFacetDimension: settings.homeDefaultFacetDimension,
    homeSelectedNodeUuids: settings.homeSelectedNodeUuids,
    homeSavedViews: settings.homeSavedViews,
    homeDefaultSavedViewId: settings.homeDefaultSavedViewId,
    moveOfflineNodesBack: settings.moveOfflineNodesBack,
    showCostSummary: settings.showCostSummary,
    showCostSummaryFloatingButton: settings.showCostSummaryFloatingButton,
    showOverviewRatings: settings.showOverviewRatings,
    overviewRatingStyle: settings.overviewRatingStyle,
    showTrafficRating: settings.showTrafficRating,
    showBandwidthRating: settings.showBandwidthRating,
    showAssetRating: settings.showAssetRating,
    trafficRatingLabels: settings.trafficRatingLabels,
    bandwidthRatingLabels: settings.bandwidthRatingLabels,
    assetRatingLabels: settings.assetRatingLabels,
    compactShowTrafficTotal: settings.compactShowTrafficTotal,
    compactShowBilling: settings.compactShowBilling,
    compactShowUptime: settings.compactShowUptime,
    showConnections: settings.showConnections,
    costIgnoredNodes: settings.costIgnoredNodes,
    costRateApiUrl: settings.costRateApiUrl,
    backgroundImage: settings.backgroundImage,
    backgroundImageMobile: settings.backgroundImageMobile,
    backgroundAlignment: settings.backgroundAlignment,
    surfaceOpacity: settings.surfaceOpacity,
  };
}

export function managedSettingsSignature(settings: ThemeSettings & Record<string, unknown>) {
  return JSON.stringify(canonicalize(pickManagedThemeSettings(normalizeThemeSettings(settings))));
}

export function buildStudioPayload(server: ThemeSettings & Record<string, unknown>, draft: ThemeSettings & Record<string, unknown>) {
  const next: ThemeSettings & Record<string, unknown> = { ...server, ...pickManagedThemeSettings(normalizeThemeSettings(draft)) };
  delete next.homepagePingTask;
  return next;
}

const settingLabels: Partial<Record<keyof ThemeSettings, string>> = {
  defaultAppearance: '默认外观', displayTimeZone: '显示时区', desktopNodeViewMode: '桌面布局', mobileNodeViewMode: '移动布局',
  homepagePingBindings: '节点探测任务', homepagePingTaskOrder: '探测任务顺序', homepagePingAggregationStrategy: '网络汇总策略', homepagePingPrimaryTasks: '主线路', homepagePingTaskGroups: '探测分组',
  showHomeOverview: '首页总览', showGroupTabs: '分组导航', homeGroupOrder: '分组顺序', homeFacetDimensions: '分类维度', homeNodeFacets: '节点标签', homeDefaultFacetDimension: '默认分类', homeSelectedNodeUuids: '首页节点范围', homeSavedViews: '保存视图', homeDefaultSavedViewId: '默认视图', moveOfflineNodesBack: '离线节点位置',
  showCostSummary: '资产统计', showCostSummaryFloatingButton: '资产入口', showOverviewRatings: '总览评级', overviewRatingStyle: '评级风格', showTrafficRating: '流量评级', showBandwidthRating: '带宽评级', showAssetRating: '资产评级', trafficRatingLabels: '流量等级名称', bandwidthRatingLabels: '带宽等级名称', assetRatingLabels: '资产等级名称',
  compactShowTrafficTotal: '累计流量指标', compactShowBilling: '计费指标', compactShowUptime: '运行时间指标', showConnections: '连接数指标', costIgnoredNodes: '资产统计范围', costRateApiUrl: '汇率来源', backgroundImage: '桌面背景', backgroundImageMobile: '移动背景', backgroundAlignment: '背景位置与缩放', surfaceOpacity: '卡片不透明度',
};

export function summarizeStudioChanges(before: ThemeSettings, after: ThemeSettings): string[] {
  const baseline = pickManagedThemeSettings(normalizeThemeSettings({ ...before }));
  const draft = pickManagedThemeSettings(normalizeThemeSettings({ ...after }));
  return (Object.keys(draft) as (keyof ThemeSettings)[])
    .filter(key => JSON.stringify(canonicalize(baseline[key])) !== JSON.stringify(canonicalize(draft[key])))
    .map(key => settingLabels[key] ?? '主题设置');
}
