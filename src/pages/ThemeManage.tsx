import { HomepagePreview } from "@/components/settings/HomepagePreview";
import { validateStudioInputs } from "@/utils/studioValidation";
import { useStudioDraft } from "@/hooks/useStudioDraft";
import { StudioDiagnostics } from "@/components/settings/StudioDiagnostics";
import { SavedViewSortEditor } from "@/components/settings/SavedViewSortEditor";
import { SavedViewCard } from "@/components/settings/SavedViewCard";
import { TaskGroupEditor } from "@/components/settings/TaskGroupEditor";
import { PrimaryTaskEditor } from "@/components/settings/PrimaryTaskEditor";
import { NetworkStrategyEditor } from "@/components/settings/NetworkStrategyEditor";
import { DimensionEditor } from "@/components/settings/DimensionEditor";
import { TagValueEditor } from "@/components/settings/TagValueEditor";
import { RatingEditor } from "@/components/settings/RatingEditor";
import { OverviewEditor } from "@/components/settings/OverviewEditor";
import { TimeZoneEditor } from "@/components/settings/TimeZoneEditor";
import { managedSettingsSignature, buildStudioPayload, summarizeStudioChanges } from "@/utils/settingsStudioModel";
import { BackgroundEditor } from "@/components/settings/BackgroundEditor";
import { MetricVisibilityEditor } from "@/components/settings/MetricVisibilityEditor";
import { AssetEditor } from "@/components/settings/AssetEditor";
import { AppearanceEditor, DeviceLayoutEditor } from "@/components/settings/AppearanceEditor";
import { settingsSyncAction } from "@/utils/settingsSync";
import { NodeScopeEditor, FacetScopeEditor } from "@/components/settings/ViewScopeEditor";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useBlocker } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CircleDollarSign,
	  Globe2,
	  LayoutTemplate,
	  LayoutGrid,
	  ListFilter,
	  Plus,
	  RefreshCw,
	  Rows3,
	  Save,
	  Search,
	  Tags,
	  Trash2,
	  Wallpaper,
	} from "lucide-react";
import { SettingsStudio, StudioPanel } from "@/components/settings/SettingsStudio";
import { Spinner } from "@/components/ui/Spinner";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { queryClient } from "@/services/queryClient";
import {
  ApiRequestError,
  getAdminClients,
  getAdminPingTasks,
  saveThemeSettings,
} from "@/services/api";
import type { AdminClient, PingTask, ThemeSettings } from "@/types/komari";
import {
  normalizeBackgroundAlignment,
  normalizeBackgroundUrl,
} from "@/utils/background";
import {
  normalizeCostIgnoredNodes,
  normalizeCostRateApiUrl,
} from "@/utils/cost";
import {
  dedupeGroupLabels,
  normalizeHomeGroupOrder,
  sortHomeGroupOptions,
} from "@/utils/homeNodes";
import {
  DEFAULT_HOME_FACET_DIMENSIONS,
  HOME_FACET_LEGACY_GROUP,
  buildHomeFacetNode,
  normalizeHomeDefaultFacetDimension,
  normalizeHomeDefaultSavedViewId,
  normalizeHomeFacetDimensions,
  normalizeHomeFacetValues,
  normalizeHomeNodeFacets,
  normalizeHomeSavedViews,
  normalizeHomeSelectedNodeUuids,
  type HomeFacetDimension,
  type HomeFacetFilters,
  type HomeNodeFacets,
  type HomeSavedView,
} from "@/utils/homeVpsViews";
import { buildHomepagePingClientBindingRows } from "@/utils/homepagePingBindingRows";
import {
  filterHomepagePingTaskGroups,
  normalizeHomepagePingPrimaryTasks,
  normalizeHomepagePingTaskGroups,
} from "@/utils/homepagePingSettings";
import {
  countHomepagePingBindingPairs,
  countHomepagePingBoundClients,
  filterHomepagePingTaskBindings,
  normalizeHomepagePingTaskOrder,
  normalizeHomepagePingTaskBindings,
  type HomepagePingTaskBindings,
} from "@/utils/pingTasks";
import { NetworkBindingEditor } from "@/components/settings/NetworkBindingEditor";
import { buildPingDiagnostics } from "@/utils/pingDiagnostics";
import {
  normalizeThemeSettings,
  type ResolvedThemeSettings,
} from "@/utils/themeSettings";
import {
  DEFAULT_VPS_LIST_SORTS,
} from "@/utils/vpsListSort";
import {
  formatDisplayDateTime,
  normalizeDisplayTimeZone,
} from "@/utils/timeDisplay";
import {
  type OverviewRatingKind,
} from "@/utils/overviewRating";

const HOME_VIEW_SORT_OPTIONS = [
  { value: "weight", label: "默认排序" },
  { value: "risk", label: "风险优先" },
  { value: "expiry", label: "到期时间" },
  { value: "traffic", label: "流量压力" },
  { value: "bandwidth", label: "实时带宽" },
  { value: "completeness", label: "资料缺失" },
  { value: "name", label: "名称" },
];
const DEFAULT_HOME_FACET_IDS = new Set(DEFAULT_HOME_FACET_DIMENSIONS.map((dimension) => dimension.id));

function sortTasks(tasks: PingTask[]) {
  return [...tasks].sort((left, right) => {
    if (left.weight !== right.weight) return left.weight - right.weight;
    if (left.id !== right.id) return left.id - right.id;
    return left.name.localeCompare(right.name);
  });
}

function sortClients(clients: AdminClient[]) {
  return [...clients].sort((left, right) => {
    if (left.weight !== right.weight) return left.weight - right.weight;
    return left.name.localeCompare(right.name);
  });
}

function pruneBindings(bindings: HomepagePingTaskBindings) {
  const normalized = normalizeHomepagePingTaskBindings(bindings);
  const pruned: HomepagePingTaskBindings = {};

  for (const [taskId, clients] of Object.entries(normalized)) {
    if (clients.length > 0) {
      pruned[taskId] = clients;
    }
  }

  return pruned;
}

function clearFacetFilter(filters: HomeFacetFilters, dimensionId: string) {
  const next = { ...filters };
  delete next[dimensionId];
  return next;
}

function createSavedViewId(existing: HomeSavedView[]) {
  const used = new Set(existing.map((view) => view.id));
  for (let index = existing.length + 1; index < existing.length + 100; index += 1) {
    const id = `view${index}`;
    if (!used.has(id)) return id;
  }
  return `view${Date.now().toString(36)}`;
}

function createCustomDimensionId(existing: HomeFacetDimension[]) {
  const used = new Set(existing.map((dimension) => dimension.id));
  for (let index = 1; index < 100; index += 1) {
    const id = `custom${index}`;
    if (!used.has(id)) return id;
  }
  return `custom${Date.now().toString(36)}`;
}

export function ThemeManage() {
  const { data: config, isLoading: configLoading } = usePublicConfig();
  const {
    draftAppearance, setDraftAppearance,
    draftDisplayTimeZoneText, setDraftDisplayTimeZoneText,
    draftDesktopNodeViewMode, setDraftDesktopNodeViewMode,
    draftMobileNodeViewMode, setDraftMobileNodeViewMode,
    draftBindings, setDraftBindings,
    draftPingTaskOrder, setDraftPingTaskOrder,
    draftPingAggregationStrategy, setDraftPingAggregationStrategy,
    draftPingPrimaryTasks, setDraftPingPrimaryTasks,
    draftPingTaskGroups, setDraftPingTaskGroups,
    draftShowHomeOverview, setDraftShowHomeOverview,
    draftShowGroupTabs, setDraftShowGroupTabs,
    draftHomeGroupOrder, setDraftHomeGroupOrder,
    draftFacetDimensions, setDraftFacetDimensions,
    draftHomeNodeFacets, setDraftHomeNodeFacets,
    draftHomeDefaultFacetDimension, setDraftHomeDefaultFacetDimension,
    draftHomeSelectedNodeUuids, setDraftHomeSelectedNodeUuids,
    draftHomeSavedViews, setDraftHomeSavedViews,
    draftHomeDefaultSavedViewId, setDraftHomeDefaultSavedViewId,
    draftMoveOfflineNodesBack, setDraftMoveOfflineNodesBack,
    draftShowCostSummary, setDraftShowCostSummary,
    draftShowCostSummaryFloatingButton, setDraftShowCostSummaryFloatingButton,
    draftShowOverviewRatings, setDraftShowOverviewRatings,
    draftOverviewRatingStyle, setDraftOverviewRatingStyle,
    draftShowTrafficRating, setDraftShowTrafficRating,
    draftShowBandwidthRating, setDraftShowBandwidthRating,
    draftShowAssetRating, setDraftShowAssetRating,
    draftRatingLabels, setDraftRatingLabels,
    draftCompactShowTrafficTotal, setDraftCompactShowTrafficTotal,
    draftCompactShowBilling, setDraftCompactShowBilling,
    draftCompactShowUptime, setDraftCompactShowUptime,
    draftShowConnections, setDraftShowConnections,
    draftCostIgnoredText, setDraftCostIgnoredText,
    draftCostRateApiUrl, setDraftCostRateApiUrl,
    draftBackgroundImage, setDraftBackgroundImage,
    draftBackgroundImageMobile, setDraftBackgroundImageMobile,
    draftBackgroundAlignment, setDraftBackgroundAlignment,
    draftSurfaceOpacity, setDraftSurfaceOpacity,
    seedDrafts,
  } = useStudioDraft();
  const [createdViewId, setCreatedViewId] = useState<string | null>(null);
  const [facetSearch, setFacetSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timePreviewNow, setTimePreviewNow] = useState(() => Date.now());

  const {
    data: pingTasks,
    isLoading: tasksLoading,
    error: tasksError,
  } = useQuery({
    queryKey: ["admin", "ping-tasks"],
    queryFn: getAdminPingTasks,
    staleTime: 30_000,
    retry: false,
  });
  const {
    data: adminClients,
    isLoading: clientsLoading,
    error: clientsError,
  } = useQuery({
    queryKey: ["admin", "clients"],
    queryFn: getAdminClients,
    staleTime: 30_000,
    retry: false,
  });

  const sourceThemeSettings = useMemo(
    () => normalizeThemeSettings(config?.theme_settings),
    [config?.theme_settings],
  );
  // 服务端设置的内容签名。React Query 每次 ["public"] refetch(聚焦、过期、失效)都返回
  // 新的 `config` 对象,即使字节完全一样,每个 `source*` 值也会是新身份。用这个签名作为
  // reseed 的判断依据,并记录上次实际应用的值,这样内容相同的 refetch 不会冲掉未保存的草稿,
  // 而服务端数据真的变了时仍会重新 seed。
  const sourceSignature = useMemo(
    () => managedSettingsSignature({ ...sourceThemeSettings }),
    [sourceThemeSettings],
  );
  const [baseline, setBaseline] = useState<ResolvedThemeSettings | null>(null);
  const baselineSignature = baseline ? managedSettingsSignature({ ...baseline }) : null;



  useEffect(() => {
    const timer = window.setInterval(() => setTimePreviewNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const sortedTasks = useMemo(() => sortTasks(pingTasks ?? []), [pingTasks]);
  const activePingTaskIds = useMemo(
    () => sortedTasks.map((task) => task.id),
    [sortedTasks],
  );
  const canValidatePingTasks = !tasksLoading && !tasksError;
  const sortedClients = useMemo(() => sortClients(adminClients ?? []), [adminClients]);
  // 后端实际存在的分组,按首页 Tab 的渲染顺序排列(已配置的在前,未排序的在后)。
  // 用户直接拖动这个列表来调整顺序。
  const availableGroups = useMemo(
    () => dedupeGroupLabels(sortedClients.map((client) => client.group)),
    [sortedClients],
  );
  const orderedDraftGroups = useMemo(
    () => sortHomeGroupOptions(availableGroups, draftHomeGroupOrder),
    [availableGroups, draftHomeGroupOrder],
  );
  const moveGroup = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= orderedDraftGroups.length) return;
    const next = [...orderedDraftGroups];
    [next[index], next[target]] = [next[target], next[index]];
    setDraftHomeGroupOrder(next);
  };

  const visibleFacetClients = useMemo(() => {
    const keyword = facetSearch.trim().toLowerCase();
    if (!keyword) return sortedClients;
    return sortedClients.filter((client) => {
      const facetNode = buildHomeFacetNode(client, draftHomeNodeFacets);
      const haystack = [
        client.name,
        client.uuid,
        client.group,
        client.region,
        client.provider,
        client.business_role,
        client.tags,
        client.public_remark,
        client.remark,
        ...Object.values(facetNode.facets).flat(),
      ]
        .map((value) => String(value ?? "").trim().toLowerCase())
        .filter(Boolean)
        .join(" ");
      return haystack.includes(keyword);
    });
  }, [draftHomeNodeFacets, facetSearch, sortedClients]);

  const draftCostIgnoredNodes = useMemo(
    () => normalizeCostIgnoredNodes(draftCostIgnoredText),
    [draftCostIgnoredText],
  );
  const normalizedDraftCostRateApiUrl = normalizeCostRateApiUrl(draftCostRateApiUrl);
  const validationErrors = validateStudioInputs({ rateUrl: draftCostRateApiUrl, timeZone: draftDisplayTimeZoneText });
  const draftCostRateApiUrlInvalid = !!validationErrors.rateUrl;
  const draftDisplayTimeZoneInvalid = !!validationErrors.timeZone;
  const normalizedDraftDisplayTimeZone = normalizeDisplayTimeZone(draftDisplayTimeZoneText);
  const displayTimeZonePreview = draftDisplayTimeZoneInvalid
    ? "请输入有效的 IANA 时区，例如 Asia/Shanghai"
    : formatDisplayDateTime(timePreviewNow, normalizedDraftDisplayTimeZone, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
  const locallyPrunedDraftBindings = useMemo(
    () => pruneBindings(draftBindings),
    [draftBindings],
  );
  const prunedDraftBindings = useMemo(() => {
    const bindings = locallyPrunedDraftBindings;
    return canValidatePingTasks
      ? filterHomepagePingTaskBindings(bindings, activePingTaskIds)
      : bindings;
  }, [activePingTaskIds, canValidatePingTasks, locallyPrunedDraftBindings]);
  const normalizedDraftPingPrimaryTasks = useMemo(
    () => normalizeHomepagePingPrimaryTasks(draftPingPrimaryTasks, prunedDraftBindings),
    [draftPingPrimaryTasks, prunedDraftBindings],
  );
  const normalizedDraftPingTaskGroups = useMemo(
    () => {
      const taskGroups = normalizeHomepagePingTaskGroups(draftPingTaskGroups);
      return canValidatePingTasks
        ? filterHomepagePingTaskGroups(taskGroups, activePingTaskIds)
        : taskGroups;
    },
    [activePingTaskIds, canValidatePingTasks, draftPingTaskGroups],
  );
  const stalePingTaskIds = useMemo(() => {
    if (!canValidatePingTasks) return [];
    const active = new Set(activePingTaskIds);
    const referenced = new Set([
      ...Object.keys(locallyPrunedDraftBindings),
      ...Object.keys(normalizeHomepagePingTaskGroups(draftPingTaskGroups)),
    ]);
    return Array.from(referenced)
      .map(Number)
      .filter((taskId) => !active.has(taskId))
      .sort((left, right) => left - right);
  }, [activePingTaskIds, canValidatePingTasks, draftPingTaskGroups, locallyPrunedDraftBindings]);
  const normalizedDraftFacetDimensions = useMemo(
    () => normalizeHomeFacetDimensions(draftFacetDimensions),
    [draftFacetDimensions],
  );
  const normalizedDraftHomeNodeFacets = useMemo(
    () => normalizeHomeNodeFacets(draftHomeNodeFacets),
    [draftHomeNodeFacets],
  );
  const normalizedDraftHomeDefaultFacetDimension = useMemo(
    () =>
      normalizeHomeDefaultFacetDimension(
        draftHomeDefaultFacetDimension,
        normalizedDraftFacetDimensions,
      ),
    [draftHomeDefaultFacetDimension, normalizedDraftFacetDimensions],
  );
  const normalizedDraftHomeSelectedNodeUuids = useMemo(
    () => normalizeHomeSelectedNodeUuids(draftHomeSelectedNodeUuids),
    [draftHomeSelectedNodeUuids],
  );
  const normalizedDraftHomeSavedViews = useMemo(
    () => normalizeHomeSavedViews(draftHomeSavedViews, normalizedDraftFacetDimensions),
    [draftHomeSavedViews, normalizedDraftFacetDimensions],
  );
  const normalizedDraftHomeDefaultSavedViewId = useMemo(
    () => normalizeHomeDefaultSavedViewId(draftHomeDefaultSavedViewId, normalizedDraftHomeSavedViews),
    [draftHomeDefaultSavedViewId, normalizedDraftHomeSavedViews],
  );

  // 由当前草稿拼出的设置 payload,保存请求和 dirty 判断都用它。新增一项设置只需改这个对象
  // (和 seedDrafts),不必同时改六处。
  const draftThemeSettings = useMemo<ThemeSettings>(
    () => ({
      defaultAppearance: draftAppearance,
      displayTimeZone: normalizedDraftDisplayTimeZone,
      desktopNodeViewMode: draftDesktopNodeViewMode,
      mobileNodeViewMode: draftMobileNodeViewMode,
      homepagePingBindings: prunedDraftBindings,
      homepagePingTaskOrder: normalizeHomepagePingTaskOrder(draftPingTaskOrder, prunedDraftBindings),
      homepagePingAggregationStrategy: draftPingAggregationStrategy,
      homepagePingPrimaryTasks: normalizedDraftPingPrimaryTasks,
      homepagePingTaskGroups: normalizedDraftPingTaskGroups,
      showHomeOverview: draftShowHomeOverview,
      showGroupTabs: draftShowGroupTabs,
      homeGroupOrder: normalizeHomeGroupOrder(draftHomeGroupOrder),
      homeFacetDimensions: normalizedDraftFacetDimensions,
      homeNodeFacets: normalizedDraftHomeNodeFacets,
      homeDefaultFacetDimension: normalizedDraftHomeDefaultFacetDimension,
      homeSelectedNodeUuids: normalizedDraftHomeSelectedNodeUuids,
      homeSavedViews: normalizedDraftHomeSavedViews,
      homeDefaultSavedViewId: normalizedDraftHomeDefaultSavedViewId,
      moveOfflineNodesBack: draftMoveOfflineNodesBack,
      showCostSummary: draftShowCostSummary,
      showCostSummaryFloatingButton: draftShowCostSummaryFloatingButton,
      showOverviewRatings: draftShowOverviewRatings,
      overviewRatingStyle: draftOverviewRatingStyle,
      showTrafficRating: draftShowTrafficRating,
      showBandwidthRating: draftShowBandwidthRating,
      showAssetRating: draftShowAssetRating,
      trafficRatingLabels: draftRatingLabels.traffic,
      bandwidthRatingLabels: draftRatingLabels.bandwidth,
      assetRatingLabels: draftRatingLabels.asset,
      compactShowTrafficTotal: draftCompactShowTrafficTotal,
      compactShowBilling: draftCompactShowBilling,
      compactShowUptime: draftCompactShowUptime,
      showConnections: draftShowConnections,
      costIgnoredNodes: draftCostIgnoredNodes,
      costRateApiUrl: normalizedDraftCostRateApiUrl,
      backgroundImage: normalizeBackgroundUrl(draftBackgroundImage),
      backgroundImageMobile: normalizeBackgroundUrl(draftBackgroundImageMobile),
      backgroundAlignment: normalizeBackgroundAlignment(draftBackgroundAlignment),
      surfaceOpacity: draftSurfaceOpacity,
    }),
    [
      draftAppearance,
      draftPingTaskOrder,
      normalizedDraftDisplayTimeZone,
      draftDesktopNodeViewMode,
      draftMobileNodeViewMode,
      prunedDraftBindings,
      draftPingAggregationStrategy,
      normalizedDraftPingPrimaryTasks,
      normalizedDraftPingTaskGroups,
      draftShowHomeOverview,
      draftShowGroupTabs,
      draftHomeGroupOrder,
      normalizedDraftFacetDimensions,
      normalizedDraftHomeNodeFacets,
      normalizedDraftHomeDefaultFacetDimension,
      normalizedDraftHomeSelectedNodeUuids,
      normalizedDraftHomeSavedViews,
      normalizedDraftHomeDefaultSavedViewId,
      draftMoveOfflineNodesBack,
      draftShowCostSummary,
      draftShowCostSummaryFloatingButton,
      draftShowOverviewRatings,
      draftOverviewRatingStyle,
      draftShowTrafficRating,
      draftShowBandwidthRating,
      draftShowAssetRating,
      draftRatingLabels,
      draftCompactShowTrafficTotal,
      draftCompactShowBilling,
      draftCompactShowUptime,
      draftShowConnections,
      draftCostIgnoredNodes,
      normalizedDraftCostRateApiUrl,
      draftBackgroundImage,
      draftBackgroundImageMobile,
      draftBackgroundAlignment,
      draftSurfaceOpacity,
    ],
  );

  // 只比较本页实际管理的设置。enableAdminButton/showPingChart 这类隐藏设置会通过
  // baseSettings 在保存时保留,但不该让表单永远显示为 dirty。
  const draftSignature = useMemo(
    () => managedSettingsSignature(draftThemeSettings as ThemeSettings & Record<string, unknown>),
    [draftThemeSettings],
  );
  // draftSignature 用的是归一化后的 cost-rate URL,非法输入会被收敛回默认值,于是非法输入
  // 不会被判为 dirty,用户既无法保存也无法重置出来。所以单独跟踪原始文本,让编辑始终把表单
  // 标为 dirty(重置可用),而保存按钮再额外按合法性把关(见下文)。
  const costRateApiUrlDirty =
    draftCostRateApiUrl.trim() !== (baseline ?? sourceThemeSettings).costRateApiUrl;
  const displayTimeZoneInputDirty =
    draftDisplayTimeZoneInvalid ||
    normalizedDraftDisplayTimeZone !== (baseline ?? sourceThemeSettings).displayTimeZone;
  const isDirty =
    baseline !== null && (draftSignature !== baselineSignature || costRateApiUrlDirty || displayTimeZoneInputDirty);

  const changeSummary = summarizeStudioChanges(baseline ?? sourceThemeSettings, draftThemeSettings);
  if (draftCostRateApiUrlInvalid && !changeSummary.includes('汇率来源')) changeSummary.push('汇率来源（需要修正）');
  if (draftDisplayTimeZoneInvalid && !changeSummary.includes('显示时区')) changeSummary.push('显示时区（需要修正）');

  const syncAction = settingsSyncAction(baselineSignature, sourceSignature, isDirty, saving);
  const hasConflict = syncAction === 'conflict';
  useEffect(() => {
    if (!config || syncAction !== 'replace') return;
    seedDrafts(sourceThemeSettings);
    setBaseline(sourceThemeSettings);
  }, [config, syncAction, seedDrafts, sourceThemeSettings]);
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);
  const blocker = useBlocker(isDirty || saving);

  // 用户重新编辑后清掉「已保存」提示,避免过期的成功提示和 dirty 表单并存。
  useEffect(() => {
    if (isDirty) setMessage(null);
  }, [isDirty]);

  const boundClientCount = useMemo(
    () => countHomepagePingBoundClients(prunedDraftBindings),
    [prunedDraftBindings],
  );
  const bindingPairCount = useMemo(
    () => countHomepagePingBindingPairs(prunedDraftBindings),
    [prunedDraftBindings],
  );
  const pingDiagnostics = useMemo(
    () =>
      buildPingDiagnostics({
        tasks: sortedTasks,
        clients: sortedClients,
        bindings: prunedDraftBindings,
      }),
    [prunedDraftBindings, sortedClients, sortedTasks],
  );

  const pingClientBindingRows = useMemo(
    () =>
      buildHomepagePingClientBindingRows({
        clients: sortedClients,
        tasks: sortedTasks,
        bindings: prunedDraftBindings,
        primaryTasks: normalizedDraftPingPrimaryTasks,
        taskGroups: normalizedDraftPingTaskGroups,
      }),
    [
      normalizedDraftPingPrimaryTasks,
      normalizedDraftPingTaskGroups,
      prunedDraftBindings,
      sortedClients,
      sortedTasks,
    ],
  );

  const setPrimaryPingTask = (clientUuid: string, taskId: number | null) => {
    setDraftPingPrimaryTasks((prev) => {
      const next = { ...prev };
      if (taskId == null) delete next[clientUuid];
      else next[clientUuid] = taskId;
      return next;
    });
  };
  const setNodeFacetValues = (clientUuid: string, dimensionId: string, text: string) => {
    const values = normalizeHomeFacetValues(text);
    setDraftHomeNodeFacets((prev) => {
      const next: HomeNodeFacets = { ...prev };
      const nodeFacets = { ...(next[clientUuid] ?? {}) };
      if (values.length > 0) nodeFacets[dimensionId] = values;
      else delete nodeFacets[dimensionId];
      if (Object.keys(nodeFacets).length > 0) next[clientUuid] = nodeFacets;
      else delete next[clientUuid];
      return normalizeHomeNodeFacets(next);
    });
  };
  const updateFacetDimension = (
    dimensionId: string,
    patch: Partial<Pick<HomeFacetDimension, "label" | "visible" | "order">>,
  ) => {
    setDraftFacetDimensions((prev) =>
      normalizeHomeFacetDimensions(
        prev.map((dimension) =>
          dimension.id === dimensionId ? { ...dimension, ...patch } : dimension,
        ),
      ),
    );
  };
  const moveFacetDimension = (dimensionId: string, direction: -1 | 1) => {
    setDraftFacetDimensions((prev) => {
      const ordered = normalizeHomeFacetDimensions(prev);
      const index = ordered.findIndex((dimension) => dimension.id === dimensionId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ordered.length) return ordered;
      const next = [...ordered];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((dimension, orderIndex) => ({ ...dimension, order: (orderIndex + 1) * 10 }));
    });
  };
  const addFacetDimension = () => {
    setDraftFacetDimensions((prev) => {
      const normalized = normalizeHomeFacetDimensions(prev);
      const id = createCustomDimensionId(normalized);
      return normalizeHomeFacetDimensions([
        ...normalized,
        { id, label: "新维度", visible: true, order: (normalized.length + 1) * 10 },
      ]);
    });
  };
  const removeFacetDimension = (dimensionId: string) => {
    if (DEFAULT_HOME_FACET_IDS.has(dimensionId)) return;
    setDraftFacetDimensions((prev) => prev.filter((dimension) => dimension.id !== dimensionId));
    setDraftHomeNodeFacets((prev) => {
      const next: HomeNodeFacets = {};
      for (const [uuid, facets] of Object.entries(prev)) {
        const nodeFacets = { ...facets };
        delete nodeFacets[dimensionId];
        if (Object.keys(nodeFacets).length > 0) next[uuid] = nodeFacets;
      }
      return next;
    });
    setDraftHomeSavedViews((prev) =>
      prev.map((view) => ({
        ...view,
        filters: clearFacetFilter(view.filters, dimensionId),
        groupBy: view.groupBy === dimensionId ? HOME_FACET_LEGACY_GROUP : view.groupBy,
      })),
    );
    if (draftHomeDefaultFacetDimension === dimensionId) {
      setDraftHomeDefaultFacetDimension(HOME_FACET_LEGACY_GROUP);
    }
  };
  const addSavedView = () => {
    const id = createSavedViewId(draftHomeSavedViews);
    setCreatedViewId(id);
    setDraftHomeSavedViews((prev) => {
      return normalizeHomeSavedViews(
        [
          ...prev,
          {
            id,
            name: `视图 ${prev.length + 1}`,
            selectedNodeUuids: [],
            filters: {},
            groupBy: normalizedDraftHomeDefaultFacetDimension,
            sortKey: "weight",
            sorts: DEFAULT_VPS_LIST_SORTS,
          },
        ],
        normalizedDraftFacetDimensions,
      );
    });
  };
  const updateSavedView = (viewId: string, patch: Partial<HomeSavedView>) => {
    setDraftHomeSavedViews((prev) =>
      normalizeHomeSavedViews(
        prev.map((view) => (view.id === viewId ? { ...view, ...patch } : view)),
        normalizedDraftFacetDimensions,
      ),
    );
  };
  const removeSavedView = (viewId: string) => {
    setDraftHomeSavedViews((prev) => prev.filter((view) => view.id !== viewId));
    if (draftHomeDefaultSavedViewId === viewId) setDraftHomeDefaultSavedViewId("");
  };

  const handleSave = async () => {
    if (!config?.theme || saving || hasConflict) return;
    if (validationErrors.rateUrl || validationErrors.timeZone) {
      setError(validationErrors.rateUrl ?? validationErrors.timeZone ?? null);
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const nextSettings = buildStudioPayload(config.theme_settings ?? {}, draftThemeSettings as ThemeSettings & Record<string, unknown>);
      await saveThemeSettings(config.theme, nextSettings);
      queryClient.setQueryData(["public"], { ...config, theme_settings: nextSettings });
      setBaseline(normalizeThemeSettings(nextSettings));
      await queryClient.invalidateQueries({ queryKey: ["public"] });
      setMessage("主题设置已保存");
    } catch (saveError) {
      if (
        saveError instanceof ApiRequestError &&
        (saveError.status === 401 || saveError.status === 403)
      ) {
        setError("登录已过期或当前账号没有保存权限。草稿已保留，请在新标签页重新登录后重试。");
        return;
      }
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setBaseline(sourceThemeSettings);
    seedDrafts(sourceThemeSettings);
    setMessage(null);
    setError(null);
  };

  if (configLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  const adminAccessDenied =
    (tasksError instanceof ApiRequestError &&
      (tasksError.status === 401 || tasksError.status === 403)) ||
    (clientsError instanceof ApiRequestError &&
      (clientsError.status === 401 || clientsError.status === 403));

  if (adminAccessDenied && !isDirty) {
    return <Navigate to="/" replace />;
  }

  const adminError =
    (adminAccessDenied ? "当前无法读取管理数据，请重新登录；未保存的修改仍保留。" : null) ||
    (tasksError instanceof Error ? tasksError.message : null) ||
    (clientsError instanceof Error ? clientsError.message : null);
  const noTasksYet = !tasksLoading && !clientsLoading && sortedTasks.length === 0;
  const setRatingLabelDraft = (kind: OverviewRatingKind, value: string) => {
    setDraftRatingLabels((prev) => ({ ...prev, [kind]: value }));
  };

  return (
    <SettingsStudio dirty={isDirty}>
      <div className="aster-studio-savebar">
        <Link to="/" className="instance-page-back">
          <ArrowLeft size={14} />
          返回首页
        </Link>
        <div className="studio-save-actions">
          <button
            type="button"
            onClick={handleReset}
            disabled={!isDirty || saving}
            className="studio-button"
          >
            <RefreshCw size={14} />
            <span>撤销修改</span>
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || saving || hasConflict || draftCostRateApiUrlInvalid || draftDisplayTimeZoneInvalid}
            className="studio-button is-primary"
          >
            {saving ? <Spinner size={14} /> : <Save size={14} />}
            <span>{saving ? "保存中" : "保存设置"}</span>
          </button>
        </div>
      </div>

      {isDirty && <details className="studio-change-summary">
        <summary>查看 {changeSummary.length} 项修改</summary>
        <p>保存后以下设置将应用到站点。撤销修改可恢复站点设置。</p>
        <ul>{changeSummary.map(label => <li key={label}>{label}</li>)}</ul>
      </details>}

      {blocker.state === 'blocked' && <section className="aster-studio-guard" role="alert" aria-label="离开前确认">
        <strong>还有未保存的修改</strong><p>继续编辑可保留草稿；离开后，这些修改会丢失。</p>
        <button type="button" className="studio-button is-primary" onClick={() => blocker.reset()}>继续编辑</button>
        <button type="button" className="studio-button" disabled={saving} onClick={() => blocker.proceed()}>放弃修改并离开</button>
      </section>}
      {hasConflict && <section className="aster-studio-guard" role="alert"><strong>站点设置已被更新</strong><p>你的草稿仍然保留。请先选择使用最新站点设置，或确认以当前草稿继续编辑后再保存。</p>
        <button type="button" className="studio-button" onClick={handleReset}>使用站点最新设置</button>
        <button type="button" className="studio-button" onClick={() => setBaseline(sourceThemeSettings)}>保留我的草稿</button>
      </section>}
      {(message || error || adminError) && <div className="aster-studio-notices">
        <div className="flex flex-col gap-3">
          {message && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-[12px] border border-[color-mix(in_srgb,var(--status-online)_28%,transparent)] bg-[color-mix(in_srgb,var(--status-online)_11%,var(--surface))] px-4 py-3 text-[13px] text-[var(--status-online)]"
            >
              {isDirty ? '主题设置已保存；保存期间的新修改仍在草稿中，请再次保存。' : message}
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="rounded-[12px] border border-[color-mix(in_srgb,var(--status-offline)_28%,transparent)] bg-[color-mix(in_srgb,var(--status-offline)_11%,var(--surface))] px-4 py-3 text-[13px] text-[var(--status-offline)]"
            >
              {error}
            </div>
          )}
          {adminError && (
            <div
              role="alert"
              className="rounded-[12px] border border-[color-mix(in_srgb,var(--status-offline)_28%,transparent)] bg-[color-mix(in_srgb,var(--status-offline)_11%,var(--surface))] px-4 py-3 text-[13px] text-[var(--status-offline)]"
            >
              无法读取后台 Ping 任务或节点列表: {adminError}
            </div>
          )}
        </div>
      </div>}

      <StudioPanel
        title="默认外观"
        description="为首次访问或尚未手动切换外观的用户设置默认显示模式；后续仍可在首页右上角按需切换。"
        aside={<LayoutTemplate size={16} />}
      >
        <AppearanceEditor value={draftAppearance} onChange={setDraftAppearance} />
        <HomepagePreview settings={draftThemeSettings}/>
      </StudioPanel>

      <StudioPanel
        title="显示时区"
        description="统一控制主题内绝对时间的显示时区；数据本身和查询时间戳保持不变。"
        aside={<Globe2 size={16} />}
      >
        <TimeZoneEditor value={draftDisplayTimeZoneText} invalid={draftDisplayTimeZoneInvalid} preview={displayTimeZonePreview} onChange={setDraftDisplayTimeZoneText}/>
      </StudioPanel>

      <StudioPanel
        title="默认卡片视图"
        description="分别设置桌面端与移动端的默认卡片尺寸；首页右上角按钮只临时切换当前设备的显示。"
        aside={<LayoutGrid size={16} />}
      >
        <DeviceLayoutEditor desktop={draftDesktopNodeViewMode} mobile={draftMobileNodeViewMode} onDesktopChange={setDraftDesktopNodeViewMode} onMobileChange={setDraftMobileNodeViewMode} />
      </StudioPanel>

      <StudioPanel
        title="背景与透明度"
        description="为站点设置自定义背景图，并调节卡片不透明度。背景图可分别为浅色 / 深色与桌面 / 移动端设置；卡片不透明度调低后会自动加上磨砂玻璃与可读性遮罩。"
        aside={<Wallpaper size={16} />}
      >
        <BackgroundEditor desktop={draftBackgroundImage} mobile={draftBackgroundImageMobile} alignment={draftBackgroundAlignment} opacity={draftSurfaceOpacity} onDesktopChange={setDraftBackgroundImage} onMobileChange={setDraftBackgroundImageMobile} onAlignmentChange={setDraftBackgroundAlignment} onOpacityChange={setDraftSurfaceOpacity}/>
      </StudioPanel>

      <StudioPanel
        title="首页巡检"
        description="控制首页顶部总览、分组筛选和节点排序方式；适合节点较多时快速查看状态。"
        aside={<ListFilter size={16} />}
      >
        <OverviewEditor overview={draftShowHomeOverview} groupsVisible={draftShowGroupTabs} offlineLast={draftMoveOfflineNodesBack} onOverviewChange={setDraftShowHomeOverview} onGroupsChange={setDraftShowGroupTabs} onOfflineChange={setDraftMoveOfflineNodesBack} groups={orderedDraftGroups} loading={clientsLoading} onMove={moveGroup}/>

        <RatingEditor enabled={draftShowOverviewRatings} onEnabledChange={setDraftShowOverviewRatings} style={draftOverviewRatingStyle} onStyleChange={setDraftOverviewRatingStyle} visible={{ traffic: draftShowTrafficRating, bandwidth: draftShowBandwidthRating, asset: draftShowAssetRating }} onVisibleChange={(kind, value) => ({ traffic: setDraftShowTrafficRating, bandwidth: setDraftShowBandwidthRating, asset: setDraftShowAssetRating })[kind](value)} labels={draftRatingLabels} onLabelsChange={setRatingLabelDraft}/>
	      </StudioPanel>

	      <StudioPanel
	        title="VPS 标签与视图"
	        description="为首页多维筛选维护标签、默认展示 VPS 与保存视图；节点分组也可作为一个筛选维度。"
	        aside={<Tags size={16} />}
	      >
	        <div className="flex flex-col gap-4">
            <DimensionEditor dimensions={normalizedDraftFacetDimensions} defaultId={normalizedDraftHomeDefaultFacetDimension} builtIn={DEFAULT_HOME_FACET_IDS} onDefaultChange={setDraftHomeDefaultFacetDimension} onAdd={addFacetDimension} onUpdate={updateFacetDimension} onMove={moveFacetDimension} onRemove={removeFacetDimension}/>


	          <section className="surface-inset px-4 py-4">
	            <div className="flex flex-wrap items-start justify-between gap-3">
	              <div>
	                <div className="text-[13px] font-semibold text-[var(--text-primary)]">
	                  VPS 多维标签
	                </div>
	                <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
	                  输入后按 Enter 添加标签，点击 × 移除；未配置时沿用节点资料。官方 Komari 未提供厂商、用途字段时，这里的首个值也会补全到首页筛选和列表展示。
	                </div>
	              </div>
	              <label className="surface-inset flex min-w-[220px] items-center gap-2 px-3 py-2">
	                <Search size={14} className="text-[var(--text-tertiary)]" />
	                <input
	                  value={facetSearch}
	                  onChange={(event) => setFacetSearch(event.target.value)}
	                  placeholder="搜索 VPS / UUID / 标签"
	                  className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[var(--text-tertiary)]"
	                />
	              </label>
	            </div>
	            <div className="mt-3 grid max-h-[460px] gap-3 overflow-auto pr-1">
	              {visibleFacetClients.map((client) => {
	                const facetNode = buildHomeFacetNode(client, normalizedDraftHomeNodeFacets);
	                const configured = normalizedDraftHomeNodeFacets[client.uuid] ?? {};
	                return (
	                  <article
	                    key={client.uuid}
	                    className="rounded-[12px] border border-[var(--hairline)] px-3 py-3"
	                  >
	                    <div className="flex flex-wrap items-center justify-between gap-2">
	                      <span className="min-w-0">
	                        <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">
	                          {client.name}
	                        </span>
	                        <span className="mt-0.5 block truncate text-[10px] text-[var(--text-tertiary)]">
	                          {[client.group, client.region, client.uuid].filter(Boolean).join(" · ")}
	                        </span>
	                      </span>
	                      {draftHomeSelectedNodeUuids.includes(client.uuid) && (
	                        <span className="rounded-full border border-[color-mix(in_srgb,var(--accent-500)_30%,var(--hairline))] px-2 py-0.5 text-[10px] text-[var(--accent-600)]">
	                          默认展示
	                        </span>
	                      )}
	                    </div>
	                    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
	                      {normalizedDraftFacetDimensions.map((dimension) => (
                          <TagValueEditor key={dimension.id} label={`${client.name} · ${dimension.label}`} values={configured[dimension.id] ?? []} inherited={facetNode.facets[dimension.id] ?? []} onChange={values => setNodeFacetValues(client.uuid, dimension.id, values.join('; '))}/>

	                      ))}
	                    </div>
	                  </article>
	                );
	              })}
	              {visibleFacetClients.length === 0 && (
	                <div className="rounded-[12px] border border-dashed border-[var(--hairline)] px-4 py-5 text-[12px] text-[var(--text-tertiary)]">
	                  没有匹配的 VPS。
	                </div>
	              )}
	            </div>
	          </section>

	          <section className="surface-inset px-4 py-4">
	            <div className="flex flex-wrap items-start justify-between gap-3">
	              <div>
	                <div className="text-[13px] font-semibold text-[var(--text-primary)]">
	                  默认指定展示
	                </div>
	                <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
	                  首页首次打开时只展示这里列出的 VPS；留空则展示全部可见 VPS。
	                </div>
	              </div>
	              <span className="text-[11px] text-[var(--text-tertiary)]">
	                {normalizedDraftHomeSelectedNodeUuids.length} 台
	              </span>
	            </div>
                <NodeScopeEditor label="首页默认节点范围" nodes={sortedClients} selected={draftHomeSelectedNodeUuids} onChange={setDraftHomeSelectedNodeUuids}/>

	          </section>

	          <section className="surface-inset px-4 py-4">
	            <div className="flex flex-wrap items-start justify-between gap-3">
	              <div>
	                <div className="text-[13px] font-semibold text-[var(--text-primary)]">
	                  保存视图
	                </div>
	                <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
	                  保存常用的指定 VPS、维度筛选、排序和默认分组维度，首页可一键切换。
	                </div>
	              </div>
	              <div className="flex flex-wrap items-center gap-2">
	                <label className="surface-inset flex items-center gap-2 px-3 py-2 text-[12px] text-[var(--text-secondary)]">
	                  <span className="shrink-0">默认视图</span>
	                  <select
	                    value={normalizedDraftHomeDefaultSavedViewId}
	                    onChange={(event) => setDraftHomeDefaultSavedViewId(event.target.value)}
	                    className="bg-transparent text-[12px] outline-none"
	                  >
	                    <option value="">无</option>
	                    {normalizedDraftHomeSavedViews.map((view) => (
	                      <option key={view.id} value={view.id}>
	                        {view.name}
	                      </option>
	                    ))}
	                  </select>
	                </label>
	                <button type="button" className="studio-button is-compact" onClick={addSavedView}>
	                  <Plus size={13} />
	                  <span>新增视图</span>
	                </button>
	              </div>
	            </div>
	            <div className="mt-3 grid gap-3">
	              {normalizedDraftHomeSavedViews.map((view) => (
	                <SavedViewCard key={view.id} autoFocus={createdViewId === view.id} view={view} isDefault={normalizedDraftHomeDefaultSavedViewId === view.id}>
	                  <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(150px,190px)_minmax(150px,190px)_auto] md:items-center">
	                    <label className="flex min-w-0 items-center gap-2">
	                      <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">
	                        视图名称
	                      </span>
	                      <input
	                        value={view.name}
	                        onChange={(event) => updateSavedView(view.id, { name: event.target.value })}
	                        className="surface-inset min-w-0 flex-1 px-3 py-2 text-[12px] outline-none"
	                        aria-label={`重命名视图 ${view.id}`}
	                      />
	                    </label>
	                    <select
	                      value={view.groupBy}
	                      onChange={(event) => updateSavedView(view.id, { groupBy: event.target.value })}
	                      className="surface-inset px-3 py-2 text-[12px] outline-none"
	                      aria-label={`设置 ${view.name} 的分组维度`}
	                    >
	                      {normalizedDraftFacetDimensions.map((dimension) => (
	                        <option key={dimension.id} value={dimension.id}>
	                          {dimension.label}
	                        </option>
	                      ))}
	                    </select>
	                    <select
	                      value={view.sortKey}
	                      onChange={(event) => updateSavedView(view.id, { sortKey: event.target.value })}
	                      className="surface-inset px-3 py-2 text-[12px] outline-none"
	                      aria-label={`设置 ${view.name} 的排序`}
	                    >
	                      {HOME_VIEW_SORT_OPTIONS.map((option) => (
	                        <option key={option.value} value={option.value}>
	                          {option.label}
	                        </option>
	                      ))}
	                    </select>
	                    <button
	                      type="button"
	                      onClick={() => removeSavedView(view.id)}
	                      className="studio-button is-compact is-danger"
	                    >
	                      <Trash2 size={13} />
	                      <span>删除</span>
	                    </button>
	                  </div>
	                  <SavedViewSortEditor
	                    viewName={view.name}
	                    sorts={view.sorts}
	                    onChange={(sorts) => updateSavedView(view.id, { sorts })}
	                  />
	                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <NodeScopeEditor label={`${view.name} 的节点范围`} nodes={sortedClients} selected={view.selectedNodeUuids} onChange={selectedNodeUuids => updateSavedView(view.id, { selectedNodeUuids })} />
                    <FacetScopeEditor dimensions={normalizedDraftFacetDimensions} filters={view.filters} onChange={filters => updateSavedView(view.id, { filters })} />
	                  </div>
	                </SavedViewCard>
	              ))}
	              {normalizedDraftHomeSavedViews.length === 0 && (
	                <div className="rounded-[12px] border border-dashed border-[var(--hairline)] px-4 py-5 text-[12px] text-[var(--text-tertiary)]">
	                  暂无保存视图。
	                </div>
	              )}
	            </div>
	          </section>
	        </div>
	      </StudioPanel>

	      <StudioPanel
	        title="小卡片显示项"
        description="按巡检需要选择卡片上的信息；实时速率始终保留。"
        aside={<Rows3 size={16} />}
      >
        <MetricVisibilityEditor traffic={draftCompactShowTrafficTotal} billing={draftCompactShowBilling} uptime={draftCompactShowUptime} connections={draftShowConnections} onTrafficChange={setDraftCompactShowTrafficTotal} onBillingChange={setDraftCompactShowBilling} onUptimeChange={setDraftCompactShowUptime} onConnectionsChange={setDraftShowConnections}/>
      </StudioPanel>

      <StudioPanel
        title="服务器花费"
        description="首页花费统计会使用实时汇率计算年化总支出、月均支出与剩余价值；忽略列表中的节点不会计入费用。"
        aside={<CircleDollarSign size={16} />}
      >
        <AssetEditor nodes={sortedClients} excluded={normalizeCostIgnoredNodes(draftCostIgnoredText)} onExcludedChange={value => setDraftCostIgnoredText(value.join('\n'))} showSummary={draftShowCostSummary} onSummaryChange={setDraftShowCostSummary} showShortcut={draftShowCostSummaryFloatingButton} onShortcutChange={setDraftShowCostSummaryFloatingButton} rateUrl={draftCostRateApiUrl} onRateUrlChange={setDraftCostRateApiUrl} invalid={draftCostRateApiUrlInvalid}/>
      </StudioPanel>

      <StudioPanel
        title="主页延迟检测"
        description={
          <>
            为每台 VPS 选择首页展示的 Ping 任务，支持多选 VPS 批量配置。卡片完整展示已选任务，并始终按配置顺序排列；聚合策略只影响汇总数值。
            {" "}
            如果当前还没有可用任务，请先前往
            {" "}
            <a href="/admin/ping" className="studio-text-link">
              后台 Ping 管理
            </a>
            {" "}
            创建任务，再回来完成绑定。
          </>
        }
        aside={
          <div className="text-[11px] text-[var(--text-tertiary)]">
            {tasksLoading || clientsLoading ? "载入中" : `${sortedTasks.length} 个任务`}
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
            <p className="text-xs text-[var(--text-secondary)]">按 VPS 勾选需要展示的任务，使用上下箭头调整卡片顺序。修改后点击页面顶部保存设置。</p>
            <div className="surface-inset flex items-center justify-between gap-3 px-3 py-2 text-[12px] text-[var(--text-secondary)]">
              <span>首页绑定</span>
              <strong className="text-[var(--text-primary)]">
                {boundClientCount} 节点 · {bindingPairCount} 关系
              </strong>
            </div>
          </div>

          {stalePingTaskIds.length > 0 && <StudioDiagnostics title="已删除任务的清理" items={[{ title: `已忽略 ${stalePingTaskIds.length} 个任务`, detail: `任务 ID ${stalePingTaskIds.join('、')}。首页不再展示这些任务；保存设置可清理其绑定、主任务和展示分组。` }]}/>}

          <details className="surface-inset p-3">
            <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">汇总策略、主任务与展示分组（可选，不影响卡片任务顺序）</summary>
          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
            <NetworkStrategyEditor value={draftPingAggregationStrategy} onChange={setDraftPingAggregationStrategy}/>

            <PrimaryTaskEditor rows={pingClientBindingRows} onChange={setPrimaryPingTask}/>
          </div>

            <TaskGroupEditor tasks={sortedTasks} groups={draftPingTaskGroups} onChange={setDraftPingTaskGroups}/>
          </details>

          <StudioDiagnostics title="网络配置检查" items={pingDiagnostics}/>

          {(tasksLoading || clientsLoading) && (
            <div className="flex min-h-[20vh] items-center justify-center">
              <Spinner size={24} />
            </div>
          )}

          {noTasksYet && (
            <div className="studio-empty-state">
              <span>当前还没有可用于首页展示的 Ping 任务。</span>
              <a href="/admin/ping" className="studio-text-link">
                前往后台 Ping 管理创建任务
              </a>
            </div>
          )}

          {!tasksLoading && !clientsLoading && <NetworkBindingEditor clients={sortedClients} tasks={sortedTasks} bindings={prunedDraftBindings} order={draftPingTaskOrder} onChange={(bindings, order) => { setDraftBindings(bindings); setDraftPingTaskOrder(order); }} />}
        </div>
      </StudioPanel>
    </SettingsStudio>
  );
}
