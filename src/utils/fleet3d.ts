import type { HomeNodeSummary } from "@/services/wsStore";
import type { NodeInfo, PingOverviewItem } from "@/types/komari";
import type { ComparisonLoadRecords } from "@/services/api";
import { formatMetricPercent, getExpireDaysRemaining } from "@/utils/format";
import {
  getConfigCompleteness,
  getTrafficForecast,
  type TrafficForecastStatus,
} from "@/utils/vpsWorkbench";
import { getVpsOperationalRisks, strongestRiskSeverity } from "@/utils/vpsRisk";
import { isValidPingLatency } from "@/utils/pingSamples";

export type Fleet3DStatus = "online" | "offline" | "unknown";
export type Fleet3DFilter = "all" | Fleet3DStatus;
export type Fleet3DFocusKind = "all" | "group" | "region";
export type Fleet3DCameraPreset = "overview" | "close" | "wide";
export type Fleet3DQuality = "high" | "balanced" | "eco";
export type Fleet3DLayoutMode = "orbit" | "globe";
export type Fleet3DPingTone = "none" | "good" | "warning" | "critical";
export type Fleet3DRiskTone = "none" | "warning" | "critical";
export type Fleet3DRendererMode = "webgpu" | "webgl2" | "webgl1" | "unavailable";
export type Fleet3DMetricKey = "cpu" | "memory" | "disk";
export type Fleet3DVisualTone = "none" | "good" | "active" | "warning" | "critical";
export type Fleet3DCameraControlState = "manual" | "auto";
export type Fleet3DVisualBadge =
  | "offline"
  | "risk"
  | "traffic"
  | "expiry"
  | "profile"
  | "ping";

export interface Fleet3DPingSignal {
  assigned: boolean;
  latency: number | null;
  loss: number | null;
  tone: Fleet3DPingTone;
  radius: number;
  fragmentation: number;
  pulse: number;
}

export interface Fleet3DRiskSignal {
  tone: Fleet3DRiskTone;
  score: number;
  issues: string[];
  completenessRatio: number;
}

export interface Fleet3DReplaySignal {
  active: boolean;
  timestamp: number;
  pressure: number;
  cpuPct: number;
  ramPct: number;
  diskPct: number;
  netRate: number;
}

export interface Fleet3DMetricArc {
  key: Fleet3DMetricKey;
  label: string;
  ratio: number;
  color: string;
  tone: Fleet3DVisualTone;
}

export interface Fleet3DVisualEncoding {
  statusColor: string;
  glowColor: string;
  riskColor: string;
  riskRadius: number;
  resourceArcs: Fleet3DMetricArc[];
  resourcePeakRatio: number;
  pingTone: Fleet3DVisualTone;
  trafficTone: Fleet3DVisualTone;
  trafficPressure: number;
  expiryTone: Fleet3DVisualTone;
  completenessTone: Fleet3DVisualTone;
  badges: Fleet3DVisualBadge[];
  coreScale: number;
  haloOpacity: number;
  summary: string;
}

export interface Fleet3DNode {
  uuid: string;
  name: string;
  group: string;
  region: string;
  status: Fleet3DStatus;
  color: string;
  glowColor: string;
  scale: number;
  orbitIndex: number;
  orbitRadius: number;
  position: [number, number, number];
  netUp: number;
  netDown: number;
  netRate: number;
  trafficTotal: number;
  trafficLimit: number;
  trafficFraction: number;
  trafficStatus: TrafficForecastStatus;
  trafficRemaining: number;
  cpuPct: number;
  ramPct: number;
  diskPct: number;
  expireDays: number | null;
  updatedAt: number;
  ping: Fleet3DPingSignal;
  risk: Fleet3DRiskSignal;
  visual: Fleet3DVisualEncoding;
  replay?: Fleet3DReplaySignal;
}

export interface Fleet3DOrbit {
  group: string;
  index: number;
  radius: number;
  y: number;
}

export interface Fleet3DModel {
  nodes: Fleet3DNode[];
  orbits: Fleet3DOrbit[];
  online: number;
  offline: number;
  unknown: number;
  riskCritical: number;
  riskWarning: number;
}

export interface Fleet3DReplayState {
  nodes: Fleet3DNode[];
  timestamp: number;
  sampleCount: number;
}

export interface Fleet3DFocusState {
  kind: Fleet3DFocusKind;
  value: string;
  label: string;
  uuids: string[];
  center: [number, number, number] | null;
}

export interface Fleet3DCruiseTarget {
  id: string;
  label: string;
  detail: string;
  uuids: string[];
  center: [number, number, number] | null;
  cameraPreset: Fleet3DCameraPreset;
  riskScan: boolean;
  attentionUuid: string | null;
}

export interface Fleet3DStoryStep {
  id: string;
  uuid: string;
  title: string;
  detail: string;
  issues: string[];
  tone: Fleet3DRiskTone;
  center: [number, number, number];
}

export interface Fleet3DGlobeLayout {
  nodes: Fleet3DNode[];
  matched: number;
  unmatched: number;
  total: number;
  available: boolean;
}

export interface Fleet3DRendererCapability {
  mode: Fleet3DRendererMode;
  label: string;
  detail: string;
  webgpu: boolean;
  webgl2: boolean;
  webgl1: boolean;
}

export interface Fleet3DFitCameraFrame {
  center: [number, number, number];
  radius: number;
  distance: number;
}

const STATUS_COLORS: Record<Fleet3DStatus, { color: string; glowColor: string }> = {
  online: { color: "#50d890", glowColor: "#8fffc1" },
  offline: { color: "#ff5d73", glowColor: "#ff9aaa" },
  unknown: { color: "#93a4bd", glowColor: "#d7e2f5" },
};
const STATUS_LABELS_FALLBACK: Record<Fleet3DStatus, string> = {
  online: "在线",
  offline: "离线",
  unknown: "未知",
};
const GLOBE_RADIUS = 5.2;
const REGION_COORDINATES = [
  { patterns: ["united states", "usa", "us", "美国", "洛杉矶", "纽约", "lax", "nyc", "chicago", "dallas"], lat: 37.1, lon: -95.7 },
  { patterns: ["hong kong", "hk", "香港"], lat: 22.32, lon: 114.17 },
  { patterns: ["japan", "jp", "日本", "tokyo", "osaka", "东京", "大阪"], lat: 36.2, lon: 138.25 },
  { patterns: ["singapore", "sg", "新加坡"], lat: 1.35, lon: 103.82 },
  { patterns: ["taiwan", "tw", "台湾", "taipei", "台北"], lat: 23.7, lon: 121 },
  { patterns: ["south korea", "korea", "kr", "韩国", "seoul", "首尔"], lat: 36.5, lon: 127.8 },
  { patterns: ["germany", "de", "德国", "frankfurt", "法兰克福"], lat: 51.1, lon: 10.4 },
  { patterns: ["netherlands", "nl", "荷兰", "amsterdam", "阿姆斯特丹"], lat: 52.1, lon: 5.3 },
  { patterns: ["united kingdom", "uk", "gb", "英国", "london", "伦敦"], lat: 55.4, lon: -3.4 },
  { patterns: ["france", "fr", "法国", "paris", "巴黎"], lat: 46.2, lon: 2.2 },
  { patterns: ["canada", "ca", "加拿大", "toronto", "vancouver", "多伦多", "温哥华"], lat: 56.1, lon: -106.3 },
  { patterns: ["australia", "au", "澳大利亚", "sydney", "悉尼"], lat: -25.3, lon: 133.8 },
] as const;

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeGroup(value: string | null | undefined) {
  const group = String(value || "").trim();
  return group || "未分组";
}

function normalizeRegion(value: string | null | undefined) {
  const region = String(value || "").trim();
  return region || "未知地区";
}

function resolveStatus(summary: HomeNodeSummary | undefined): Fleet3DStatus {
  if (!summary || summary.online == null) return "unknown";
  return summary.online ? "online" : "offline";
}

function buildSummaryMap(summaries: HomeNodeSummary[]) {
  return new Map(summaries.map((summary) => [summary.uuid, summary]));
}

function trafficScale(summary: HomeNodeSummary | undefined) {
  if (!summary) return 1;
  const rate = Math.max(0, summary.netUp + summary.netDown);
  return 1 + clamp(Math.log10(rate + 1) / 6, 0, 1) * 1.2;
}

function pingSignal(ping: PingOverviewItem | undefined): Fleet3DPingSignal {
  if (!ping || !ping.isAssigned) {
    return {
      assigned: false,
      latency: null,
      loss: null,
      tone: "none",
      radius: 0,
      fragmentation: 0,
      pulse: 0,
    };
  }

  const latency = isValidPingLatency(ping.lastValue) ? ping.lastValue : null;
  const loss = ping.loss != null && Number.isFinite(ping.loss) ? Math.max(0, ping.loss) : null;
  const hasSamples = ping.values.length > 0;
  const tone: Fleet3DPingTone =
    (loss != null && loss >= 20) || (latency != null && latency >= 1000)
      ? "critical"
      : (loss != null && loss >= 5) || (latency != null && latency >= 300)
        ? "warning"
        : hasSamples
          ? "good"
          : "none";
  const latencyPressure = latency == null ? 0 : clamp(latency / 1000, 0, 1);
  const lossPressure = loss == null ? 0 : clamp(loss / 25, 0, 1);

  return {
    assigned: true,
    latency,
    loss,
    tone,
    radius: tone === "none" ? 0 : 0.28 + latencyPressure * 0.36 + lossPressure * 0.2,
    fragmentation: loss == null ? 0 : clamp(loss / 35, 0, 1),
    pulse: tone === "critical" ? 0.9 : tone === "warning" ? 0.55 : tone === "good" ? 0.16 : 0,
  };
}

function riskSignal(
  node: NodeInfo,
  summary: HomeNodeSummary | undefined,
  ping: PingOverviewItem | undefined,
): Fleet3DRiskSignal {
  const hasPingBinding = Boolean(ping?.isAssigned);
  const risks = getVpsOperationalRisks({
    uuid: node.uuid,
    online: summary?.online ?? null,
    updatedAt: summary?.updatedAt ?? 0,
    trafficUp: summary?.trafficUp ?? 0,
    trafficDown: summary?.trafficDown ?? 0,
    trafficLimit: node.traffic_limit,
    trafficLimitType: node.traffic_limit_type,
    expiredAt: node.expired_at,
    capabilityPing: node.capability_ping,
    hasPingBinding,
  });
  const completeness = getConfigCompleteness(node, hasPingBinding);
  const issues = risks.map((risk) => risk.title);
  if (completeness.ratio < 1) {
    const missing = completeness.missing.slice(0, 2).map((item) => item.label).join("、");
    issues.push(missing ? `资料待补：${missing}` : "资料待补");
  }

  const riskTone =
    risks.length > 0
      ? strongestRiskSeverity(risks)
      : completeness.ratio < 1
        ? "warning"
        : "none";
  const criticalWeight = risks.filter((risk) => risk.severity === "critical").length * 0.42;
  const warningWeight = risks.filter((risk) => risk.severity === "warning").length * 0.24;
  const completenessWeight = (1 - completeness.ratio) * 0.34;

  return {
    tone: riskTone,
    score: riskTone === "none" ? 0 : clamp(0.28 + criticalWeight + warningWeight + completenessWeight, 0, 1),
    issues: Array.from(new Set(issues)).slice(0, 4),
    completenessRatio: completeness.ratio,
  };
}

function sortNodes(nodes: NodeInfo[]) {
  return [...nodes].sort((a, b) => {
    const groupCompare = normalizeGroup(a.group).localeCompare(normalizeGroup(b.group));
    if (groupCompare !== 0) return groupCompare;
    const weightCompare = (b.weight ?? 0) - (a.weight ?? 0);
    if (weightCompare !== 0) return weightCompare;
    return (a.name || a.uuid).localeCompare(b.name || b.uuid);
  });
}

function toRecordTimestamp(value: string | number) {
  if (typeof value === "number") return value > 1_000_000_000_000 ? value : value * 1000;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function percent(part: number, total: number) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return clamp((part / total) * 100, 0, 100);
}

function replayTone(pressure: number) {
  if (pressure >= 0.82) return { color: "#ff6678", glowColor: "#ff9aaa" };
  if (pressure >= 0.6) return { color: "#ffc857", glowColor: "#ffe0a3" };
  return { color: "#50d890", glowColor: "#8fffc1" };
}

type Fleet3DVisualNodeInput = Omit<Fleet3DNode, "visual">;

function percentRatio(value: number) {
  return clamp((Number.isFinite(value) ? value : 0) / 100, 0, 1);
}

function resourceTone(ratio: number): Fleet3DVisualTone {
  if (ratio >= 0.92) return "critical";
  if (ratio >= 0.72) return "warning";
  if (ratio > 0.02) return "active";
  return "none";
}

function trafficTone(status: TrafficForecastStatus, pressure: number, netRate: number): Fleet3DVisualTone {
  if (status === "exhausted" || status === "critical") return "critical";
  if (status === "warning") return "warning";
  if (pressure > 0.04 || netRate > 0) return "active";
  return "none";
}

function expiryTone(expireDays: number | null): Fleet3DVisualTone {
  if (expireDays == null) return "none";
  if (expireDays <= 7) return "critical";
  if (expireDays <= 30) return "warning";
  return "none";
}

function completenessTone(ratio: number): Fleet3DVisualTone {
  if (ratio < 0.65) return "critical";
  if (ratio < 1) return "warning";
  return "none";
}

function pingVisualTone(tone: Fleet3DPingTone): Fleet3DVisualTone {
  if (tone === "critical") return "critical";
  if (tone === "warning") return "warning";
  if (tone === "good") return "good";
  return "none";
}

function visualRiskColor(tone: Fleet3DRiskTone) {
  if (tone === "critical") return "#ff6678";
  if (tone === "warning") return "#ffc857";
  return "#8fffc1";
}

function buildVisualSummary(node: Fleet3DVisualNodeInput) {
  const pressure = formatMetricPercent(Math.max(node.cpuPct, node.ramPct, node.diskPct));
  const traffic = formatMetricPercent(node.trafficFraction * 100);
  const expiry = node.expireDays == null ? "未设到期" : `${node.expireDays} 天到期`;
  return `${STATUS_LABELS_FALLBACK[node.status]} · 资源 ${pressure} · 流量 ${traffic} · ${expiry}`;
}

export function encodeFleet3DNodeVisual(node: Fleet3DVisualNodeInput): Fleet3DVisualEncoding {
  const cpuRatio = percentRatio(node.replay?.active ? node.replay.cpuPct : node.cpuPct);
  const memoryRatio = percentRatio(node.replay?.active ? node.replay.ramPct : node.ramPct);
  const diskRatio = percentRatio(node.replay?.active ? node.replay.diskPct : node.diskPct);
  const resourcePeakRatio = Math.max(cpuRatio, memoryRatio, diskRatio);
  const bandwidthPressure = clamp(Math.log10(node.netRate + 1) / 7, 0, 1);
  const trafficPressure = clamp(Math.max(node.trafficFraction, bandwidthPressure * 0.58), 0, 1);
  const currentTrafficTone = trafficTone(node.trafficStatus, trafficPressure, node.netRate);
  const currentExpiryTone = expiryTone(node.expireDays);
  const currentCompletenessTone = completenessTone(node.risk.completenessRatio);
  const currentPingTone = pingVisualTone(node.ping.tone);
  const badges: Fleet3DVisualBadge[] = [];

  if (node.status === "offline") badges.push("offline");
  if (node.risk.tone !== "none") badges.push("risk");
  if (currentTrafficTone === "warning" || currentTrafficTone === "critical") badges.push("traffic");
  if (currentExpiryTone === "warning" || currentExpiryTone === "critical") badges.push("expiry");
  if (currentCompletenessTone === "warning" || currentCompletenessTone === "critical") badges.push("profile");
  if (currentPingTone === "warning" || currentPingTone === "critical") badges.push("ping");

  const riskRadius = node.risk.tone === "none" ? 0 : 1 + node.risk.score * 0.72;
  const coreScale = clamp(
    0.86 + resourcePeakRatio * 0.36 + trafficPressure * 0.18 + node.risk.score * 0.2,
    0.82,
    1.72,
  );

  return {
    statusColor: node.color,
    glowColor: node.glowColor,
    riskColor: visualRiskColor(node.risk.tone),
    riskRadius,
    resourceArcs: [
      { key: "cpu", label: "CPU", ratio: cpuRatio, color: "#6aa7ff", tone: resourceTone(cpuRatio) },
      { key: "memory", label: "内存", ratio: memoryRatio, color: "#a875ff", tone: resourceTone(memoryRatio) },
      { key: "disk", label: "磁盘", ratio: diskRatio, color: "#ff8a45", tone: resourceTone(diskRatio) },
    ],
    resourcePeakRatio,
    pingTone: currentPingTone,
    trafficTone: currentTrafficTone,
    trafficPressure,
    expiryTone: currentExpiryTone,
    completenessTone: currentCompletenessTone,
    badges: Array.from(new Set(badges)).slice(0, 5),
    coreScale,
    haloOpacity: clamp(0.08 + resourcePeakRatio * 0.12 + trafficPressure * 0.16 + node.risk.score * 0.18, 0.08, 0.44),
    summary: buildVisualSummary(node),
  };
}

function riskWeight(node: Fleet3DNode) {
  if (node.risk.tone === "critical") return 2 + node.risk.score;
  if (node.risk.tone === "warning") return 1 + node.risk.score;
  return node.status === "offline" ? 0.7 : 0;
}

function centerOfNodes(nodes: Fleet3DNode[]): [number, number, number] | null {
  if (nodes.length === 0) return null;
  const center = nodes.reduce(
    (acc, node) => {
      acc[0] += node.position[0];
      acc[1] += node.position[1];
      acc[2] += node.position[2];
      return acc;
    },
    [0, 0, 0] as [number, number, number],
  );
  center[0] /= nodes.length;
  center[1] /= nodes.length;
  center[2] /= nodes.length;
  return center;
}

export function computeFleet3DFitCameraFrame(nodes: Fleet3DNode[]): Fleet3DFitCameraFrame {
  const center = centerOfNodes(nodes) ?? [0, 0, 0];
  let radius = 3.8;
  for (const node of nodes) {
    const dx = node.position[0] - center[0];
    const dy = node.position[1] - center[1];
    const dz = node.position[2] - center[2];
    radius = Math.max(radius, Math.hypot(dx, dy, dz) + 0.66 * node.scale);
  }
  return {
    center,
    radius,
    distance: clamp(radius * 2.15 + 2.8, 7.2, 26),
  };
}

export function resolveFleet3DCameraControlState({
  cruiseMode,
  storyMode,
}: {
  cruiseMode: boolean;
  storyMode: boolean;
}): Fleet3DCameraControlState {
  return cruiseMode || storyMode ? "auto" : "manual";
}

export function resolveFleet3DManualInteractionState() {
  return {
    cruiseMode: false,
    storyMode: false,
    cameraControlState: "manual" as const,
  };
}

function groupByValue(nodes: Fleet3DNode[], key: "group" | "region") {
  const grouped = new Map<string, Fleet3DNode[]>();
  for (const node of nodes) {
    const value = key === "group" ? node.group : node.region;
    grouped.set(value, [...(grouped.get(value) ?? []), node]);
  }
  return grouped;
}

function normalizeLocationText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .trim();
}

function resolveRegionCoordinate(node: Fleet3DNode) {
  const haystack = normalizeLocationText(`${node.region} ${node.group} ${node.name}`);
  if (!haystack) return null;
  return REGION_COORDINATES.find((item) =>
    item.patterns.some((pattern) => {
      const normalizedPattern = normalizeLocationText(pattern);
      if (/^[a-z]{2}$/.test(normalizedPattern)) {
        return new RegExp(`(^|\\s)${normalizedPattern}(\\s|$)`).test(haystack);
      }
      return haystack.includes(normalizedPattern);
    }),
  ) ?? null;
}

function globePosition(lat: number, lon: number, seed: number): [number, number, number] {
  const jitterLat = (((seed >>> 8) % 1000) / 1000 - 0.5) * 2.4;
  const jitterLon = (((seed >>> 16) % 1000) / 1000 - 0.5) * 3.2;
  const safeLat = clamp(lat + jitterLat, -78, 78);
  const safeLon = lon + jitterLon;
  const phi = ((90 - safeLat) * Math.PI) / 180;
  const theta = ((safeLon + 180) * Math.PI) / 180;
  const radius = GLOBE_RADIUS + (((seed >>> 24) % 1000) / 1000) * 0.32;
  return [
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  ];
}

export function buildCompareHref(uuids: string[]) {
  const selected = Array.from(new Set(uuids.filter(Boolean))).slice(0, 8);
  if (selected.length < 2) return "/compare";
  return `/compare?${new URLSearchParams({ nodes: selected.join(",") }).toString()}`;
}

export function detectFleet3DRendererCapability(): Fleet3DRendererCapability {
  if (typeof document === "undefined") {
    return {
      mode: "unavailable",
      label: "等待检测",
      detail: "浏览器环境加载后检测 3D 渲染能力",
      webgpu: false,
      webgl2: false,
      webgl1: false,
    };
  }

  const navigatorWithGpu = typeof navigator === "undefined"
    ? null
    : (navigator as Navigator & { gpu?: unknown });
  const webgpu = Boolean(navigatorWithGpu?.gpu);
  const canvas = document.createElement("canvas");
  let webgl2 = false;
  let webgl1 = false;

  try {
    webgl2 = Boolean(canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: false }));
    webgl1 = webgl2
      ? true
      : Boolean(
          canvas.getContext("webgl", { failIfMajorPerformanceCaveat: false }) ||
            canvas.getContext("experimental-webgl", { failIfMajorPerformanceCaveat: false }),
        );
  } catch {
    webgl2 = false;
    webgl1 = false;
  }

  if (webgpu) {
    return {
      mode: "webgpu",
      label: "WebGPU 可用",
      detail: webgl2 ? "当前以 WebGL2 稳定回退渲染，可安全接入 WebGPU 管线" : "浏览器暴露 WebGPU，WebGL 回退能力有限",
      webgpu,
      webgl2,
      webgl1,
    };
  }

  if (webgl2) {
    return {
      mode: "webgl2",
      label: "WebGL2 回退",
      detail: "当前设备使用 WebGL2 稳定渲染 3D 星图",
      webgpu,
      webgl2,
      webgl1,
    };
  }

  if (webgl1) {
    return {
      mode: "webgl1",
      label: "WebGL 回退",
      detail: "当前设备可运行基础 3D 渲染，建议使用省电画质",
      webgpu,
      webgl2,
      webgl1,
    };
  }

  return {
    mode: "unavailable",
    label: "渲染不可用",
    detail: "当前浏览器未提供可用的 3D 图形上下文",
    webgpu,
    webgl2,
    webgl1,
  };
}

export function buildFleet3DModel(
  nodes: NodeInfo[],
  summaries: HomeNodeSummary[],
  pingByUuid: Map<string, PingOverviewItem> = new Map(),
): Fleet3DModel {
  const summaryByUuid = buildSummaryMap(summaries);
  const visibleNodes = sortNodes(nodes.filter((node) => !node.hidden));
  const groups = Array.from(new Set(visibleNodes.map((node) => normalizeGroup(node.group))));
  const groupIndex = new Map(groups.map((group, index) => [group, index]));
  const groupCounts = new Map<string, number>();
  const groupSeen = new Map<string, number>();
  for (const node of visibleNodes) {
    const group = normalizeGroup(node.group);
    groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
  }

  const orbits: Fleet3DOrbit[] = groups.map((group, index) => ({
    group,
    index,
    radius: 4.2 + index * 1.45,
    y: (index - (groups.length - 1) / 2) * 0.42,
  }));

  let online = 0;
  let offline = 0;
  let unknown = 0;
  let riskCritical = 0;
  let riskWarning = 0;
  const fleetNodes = visibleNodes.map((node) => {
    const group = normalizeGroup(node.group);
    const orbitIndex = groupIndex.get(group) ?? 0;
    const orbit = orbits[orbitIndex] ?? { radius: 4.2, y: 0, index: 0, group };
    const count = groupCounts.get(group) ?? 1;
    const seen = groupSeen.get(group) ?? 0;
    groupSeen.set(group, seen + 1);

    const seed = hashString(node.uuid);
    const jitter = ((seed % 1000) / 1000 - 0.5) * 0.32;
    const angle = ((seen + 0.5) / count) * Math.PI * 2 + jitter;
    const radius = orbit.radius + (((seed >>> 8) % 1000) / 1000 - 0.5) * 0.62;
    const summary = summaryByUuid.get(node.uuid);
    const ping = pingByUuid.get(node.uuid);
    const status = resolveStatus(summary);
    if (status === "online") online += 1;
    else if (status === "offline") offline += 1;
    else unknown += 1;

    const tone = STATUS_COLORS[status];
    const netUp = Math.max(0, summary?.netUp ?? 0);
    const netDown = Math.max(0, summary?.netDown ?? 0);
    const netRate = netUp + netDown;
    const trafficTotal = Math.max(0, (summary?.trafficUp ?? 0) + (summary?.trafficDown ?? 0));
    const traffic = getTrafficForecast({
      trafficLimitType: node.traffic_limit_type,
      trafficUp: summary?.trafficUp ?? 0,
      trafficDown: summary?.trafficDown ?? 0,
      netUp,
      netDown,
      trafficLimit: node.traffic_limit,
    });
    const risk = riskSignal(node, summary, ping);
    if (risk.tone === "critical") riskCritical += 1;
    else if (risk.tone === "warning") riskWarning += 1;

    const base = {
      uuid: node.uuid,
      name: node.name || node.uuid,
      group,
      region: normalizeRegion(node.region),
      status,
      color: tone.color,
      glowColor: tone.glowColor,
      scale: trafficScale(summary),
      orbitIndex,
      orbitRadius: orbit.radius,
      position: [
        Math.cos(angle) * radius,
        orbit.y + (((seed >>> 16) % 1000) / 1000 - 0.5) * 0.7,
        Math.sin(angle) * radius,
      ],
      netUp,
      netDown,
      netRate,
      trafficTotal,
      trafficLimit: traffic.limit,
      trafficFraction: traffic.fraction,
      trafficStatus: traffic.status,
      trafficRemaining: traffic.remaining,
      cpuPct: clamp(summary?.cpuPct ?? 0, 0, 100),
      ramPct: clamp(summary?.ramPct ?? 0, 0, 100),
      diskPct: clamp(summary?.diskPct ?? 0, 0, 100),
      expireDays: getExpireDaysRemaining(node.expired_at),
      updatedAt: summary?.updatedAt ?? 0,
      ping: pingSignal(ping),
      risk,
    } satisfies Fleet3DVisualNodeInput;

    return {
      ...base,
      visual: encodeFleet3DNodeVisual(base),
    } satisfies Fleet3DNode;
  });

  return {
    nodes: fleetNodes,
    orbits,
    online,
    offline,
    unknown,
    riskCritical,
    riskWarning,
  };
}

export function filterFleet3DNodes(nodes: Fleet3DNode[], filter: Fleet3DFilter) {
  if (filter === "all") return nodes;
  return nodes.filter((node) => node.status === filter);
}

export function buildFleet3DCruiseTargets(nodes: Fleet3DNode[]): Fleet3DCruiseTarget[] {
  if (nodes.length === 0) return [];

  const sortedRiskNodes = [...nodes]
    .filter((node) => node.risk.tone !== "none" || node.status === "offline")
    .sort((left, right) => riskWeight(right) - riskWeight(left) || left.name.localeCompare(right.name, "zh-CN"));
  const riskTargets = sortedRiskNodes.slice(0, 4).map((node) => ({
    id: `attention:${node.uuid}`,
    label: node.name,
    detail: node.risk.issues[0] ?? STATUS_LABELS_FALLBACK[node.status],
    uuids: [node.uuid],
    center: centerOfNodes([node]),
    cameraPreset: "close" as const,
    riskScan: true,
    attentionUuid: node.uuid,
  }));

  const groupTargets = Array.from(groupByValue(nodes, "group").entries())
    .map(([group, groupNodes]) => {
      const topRiskNode = [...groupNodes].sort((left, right) => riskWeight(right) - riskWeight(left))[0] ?? null;
      return {
        id: `group:${group}`,
        label: group,
        detail: `${groupNodes.length} 台 VPS`,
        uuids: groupNodes.map((node) => node.uuid),
        center: centerOfNodes(groupNodes),
        cameraPreset: groupNodes.length > 4 ? ("overview" as const) : ("close" as const),
        riskScan: groupNodes.some((node) => node.risk.tone !== "none"),
        attentionUuid: topRiskNode && riskWeight(topRiskNode) > 0 ? topRiskNode.uuid : null,
      };
    })
    .sort((left, right) => right.uuids.length - left.uuids.length || left.label.localeCompare(right.label, "zh-CN"));

  const regionTargets = Array.from(groupByValue(nodes, "region").entries())
    .filter(([, regionNodes]) => regionNodes.length > 1)
    .map(([region, regionNodes]) => ({
      id: `region:${region}`,
      label: region,
      detail: `${regionNodes.length} 台 VPS`,
      uuids: regionNodes.map((node) => node.uuid),
      center: centerOfNodes(regionNodes),
      cameraPreset: "overview" as const,
      riskScan: regionNodes.some((node) => node.risk.tone !== "none"),
      attentionUuid: null,
    }))
    .sort((left, right) => right.uuids.length - left.uuids.length || left.label.localeCompare(right.label, "zh-CN"))
    .slice(0, 3);

  return [
    ...riskTargets,
    ...groupTargets,
    ...regionTargets,
    {
      id: "fleet:all",
      label: "全局态势",
      detail: `${nodes.length} 台 VPS`,
      uuids: nodes.map((node) => node.uuid),
      center: null,
      cameraPreset: "wide",
      riskScan: sortedRiskNodes.length > 0,
      attentionUuid: sortedRiskNodes[0]?.uuid ?? null,
    },
  ];
}

export function buildFleet3DAnomalyStory(nodes: Fleet3DNode[], limit = 6): Fleet3DStoryStep[] {
  return [...nodes]
    .filter((node) => riskWeight(node) > 0 || node.risk.issues.length > 0)
    .sort((left, right) => riskWeight(right) - riskWeight(left) || left.name.localeCompare(right.name, "zh-CN"))
    .slice(0, Math.max(0, limit))
    .map((node, index) => ({
      id: `story:${node.uuid}:${index}`,
      uuid: node.uuid,
      title: node.name,
      detail: node.risk.issues[0] ?? STATUS_LABELS_FALLBACK[node.status],
      issues: node.risk.issues.length > 0 ? node.risk.issues : [STATUS_LABELS_FALLBACK[node.status]],
      tone: node.risk.tone,
      center: node.position,
    }));
}

export function buildFleet3DGlobeLayout(nodes: Fleet3DNode[]): Fleet3DGlobeLayout {
  let matched = 0;
  const globeNodes = nodes.map((node) => {
    const coordinate = resolveRegionCoordinate(node);
    if (!coordinate) return node;
    matched += 1;
    return {
      ...node,
      position: globePosition(coordinate.lat, coordinate.lon, hashString(node.uuid)),
    } satisfies Fleet3DNode;
  });

  return {
    nodes: globeNodes,
    matched,
    unmatched: nodes.length - matched,
    total: nodes.length,
    available: matched >= 2,
  };
}

export function buildFleet3DReplayState(
  nodes: Fleet3DNode[],
  recordsByUuid: ComparisonLoadRecords,
  progress: number,
): Fleet3DReplayState {
  const safeProgress = clamp(progress, 0, 1);
  let timestamp = 0;
  let sampleCount = 0;
  const replayNodes = nodes.map((node) => {
    const records = recordsByUuid[node.uuid] ?? [];
    if (records.length === 0) return node;
    sampleCount += records.length;
    const sorted = [...records].sort(
      (left, right) => toRecordTimestamp(left.time) - toRecordTimestamp(right.time),
    );
    const index = Math.min(sorted.length - 1, Math.max(0, Math.round(safeProgress * (sorted.length - 1))));
    const record = sorted[index];
    const recordTimestamp = toRecordTimestamp(record.time);
    if (recordTimestamp > timestamp) timestamp = recordTimestamp;

    const cpuPct = clamp(record.cpu, 0, 100);
    const ramPct = percent(record.ram, record.ram_total);
    const diskPct = percent(record.disk, record.disk_total);
    const netUp = Math.max(0, record.net_out);
    const netDown = Math.max(0, record.net_in);
    const netRate = netUp + netDown;
    const networkPressure = clamp(Math.log10(netRate + 1) / 7, 0, 1);
    const resourcePressure = Math.max(cpuPct, ramPct, diskPct) / 100;
    const pressure = clamp(resourcePressure * 0.68 + networkPressure * 0.32, 0, 1);
    const tone = replayTone(pressure);

    const replayNode = {
      ...node,
      color: tone.color,
      glowColor: tone.glowColor,
      scale: node.scale * (0.86 + pressure * 0.78),
      netUp,
      netDown,
      netRate,
      cpuPct,
      ramPct,
      diskPct,
      replay: {
        active: true,
        timestamp: recordTimestamp,
        pressure,
        cpuPct,
        ramPct,
        diskPct,
        netRate,
      },
    } satisfies Fleet3DNode;

    return {
      ...replayNode,
      visual: encodeFleet3DNodeVisual(replayNode),
    } satisfies Fleet3DNode;
  });

  return {
    nodes: replayNodes,
    timestamp,
    sampleCount,
  };
}

export function getFleet3DFocusOptions(nodes: Fleet3DNode[], kind: Exclude<Fleet3DFocusKind, "all">) {
  return Array.from(new Set(nodes.map((node) => (kind === "group" ? node.group : node.region))))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
}

export function resolveFleet3DFocus(
  nodes: Fleet3DNode[],
  kind: Fleet3DFocusKind,
  value: string,
): Fleet3DFocusState {
  if (kind === "all" || !value) {
    return {
      kind: "all",
      value: "",
      label: "全部",
      uuids: nodes.map((node) => node.uuid),
      center: null,
    };
  }

  const focused = nodes.filter((node) => (kind === "group" ? node.group : node.region) === value);
  if (focused.length === 0) {
    return {
      kind: "all",
      value: "",
      label: "全部",
      uuids: nodes.map((node) => node.uuid),
      center: null,
    };
  }

  const center = focused.reduce(
    (acc, node) => {
      acc[0] += node.position[0];
      acc[1] += node.position[1];
      acc[2] += node.position[2];
      return acc;
    },
    [0, 0, 0] as [number, number, number],
  );
  center[0] /= focused.length;
  center[1] /= focused.length;
  center[2] /= focused.length;

  return {
    kind,
    value,
    label: value,
    uuids: focused.map((node) => node.uuid),
    center,
  };
}

function demoNode(partial: Partial<NodeInfo> & Pick<NodeInfo, "uuid" | "name" | "group" | "region">): NodeInfo {
  const { uuid, name, group, region, ...rest } = partial;
  return {
    uuid,
    name,
    group,
    region,
    hidden: false,
    cpu_name: "",
    cpu_cores: 1,
    arch: "",
    virtualization: "",
    os: "",
    kernel_version: "",
    version: "demo",
    ipv4: "",
    ipv6: "",
    capability_ping: true,
    capability_private_ping_targets: null,
    gpu_name: "",
    mem_total: 0,
    swap_total: 0,
    disk_total: 0,
    weight: 0,
    price: 3,
    billing_cycle: "month",
    auto_renewal: false,
    currency: "USD",
    expired_at: "",
    tags: "",
    public_remark: "",
    traffic_limit: 0,
    traffic_limit_type: "sum",
    created_at: "",
    updated_at: "",
    ...rest,
  };
}

function demoSummary(partial: Partial<HomeNodeSummary> & Pick<HomeNodeSummary, "uuid">): HomeNodeSummary {
  const { uuid, ...rest } = partial;
  return {
    uuid,
    group: "",
    region: "",
    hidden: false,
    weight: 0,
    online: true,
    cpuPct: 0,
    ramPct: 0,
    diskPct: 0,
    load1: 0,
    trafficUp: 0,
    trafficDown: 0,
    netUp: 0,
    netDown: 0,
    uptime: 0,
    updatedAt: Date.now(),
    ...rest,
  };
}

function demoPing(partial: Partial<PingOverviewItem> & Pick<PingOverviewItem, "client">): PingOverviewItem {
  const { client, ...rest } = partial;
  const value = partial.lastValue ?? 40;
  return {
    client,
    isAssigned: true,
    lastValue: value,
    values: [value],
    samples: [{ time: Date.now(), value }],
    max: value,
    loss: 0,
    ...rest,
  };
}

function isoDaysFromNow(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

export function buildFleet3DDemoModel(): Fleet3DModel {
  const nodes = [
    demoNode({
      uuid: "demo-us-hot",
      name: "us-hot-edge",
      group: "edge",
      region: "US",
      traffic_limit: 100,
      expired_at: isoDaysFromNow(6),
    }),
    demoNode({
      uuid: "demo-hk-loss",
      name: "hk-loss-node",
      group: "edge",
      region: "香港",
      traffic_limit: 200,
      expired_at: isoDaysFromNow(45),
    }),
    demoNode({
      uuid: "demo-jp-idle",
      name: "jp-idle-node",
      group: "core",
      region: "日本",
      traffic_limit: 500,
      expired_at: isoDaysFromNow(120),
    }),
    demoNode({
      uuid: "demo-de-offline",
      name: "de-offline",
      group: "backup",
      region: "德国",
      traffic_limit: 100,
      expired_at: isoDaysFromNow(20),
    }),
  ];
  const summaries = [
    demoSummary({
      uuid: "demo-us-hot",
      cpuPct: 94,
      ramPct: 78,
      diskPct: 48,
      trafficUp: 64,
      trafficDown: 29,
      netUp: 512 * 1024,
      netDown: 1024 * 1024,
    }),
    demoSummary({
      uuid: "demo-hk-loss",
      cpuPct: 12,
      ramPct: 38,
      diskPct: 31,
      trafficUp: 30,
      trafficDown: 50,
      netUp: 64 * 1024,
      netDown: 48 * 1024,
    }),
    demoSummary({
      uuid: "demo-jp-idle",
      cpuPct: 4,
      ramPct: 22,
      diskPct: 18,
      trafficUp: 20,
      trafficDown: 32,
      netUp: 0,
      netDown: 0,
    }),
    demoSummary({
      uuid: "demo-de-offline",
      online: false,
      cpuPct: 0,
      ramPct: 0,
      diskPct: 0,
      trafficUp: 81,
      trafficDown: 7,
      updatedAt: Date.now() - 900_000,
    }),
  ];
  const pingByUuid = new Map([
    ["demo-us-hot", demoPing({ client: "demo-us-hot", lastValue: 82, loss: 0 })],
    ["demo-hk-loss", demoPing({ client: "demo-hk-loss", lastValue: 420, loss: 12 })],
    ["demo-jp-idle", demoPing({ client: "demo-jp-idle", lastValue: 42, loss: 0 })],
    ["demo-de-offline", demoPing({ client: "demo-de-offline", lastValue: 0, values: [], loss: 0 })],
  ]);

  return buildFleet3DModel(nodes, summaries, pingByUuid);
}
