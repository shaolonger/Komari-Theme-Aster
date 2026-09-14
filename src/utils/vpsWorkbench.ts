import type { NodeInfo, PingOverviewItem } from "@/types/komari";
import { formatRenewalPrice } from "@/utils/billing";
import { formatLatency, formatPacketLoss, getExpireDaysRemaining } from "@/utils/format";
import { computeTrafficUsed, resolveTrafficUsage } from "@/utils/traffic";
import { getVpsOperationalRisks, strongestRiskSeverity, type VpsRisk } from "@/utils/vpsRisk";

export type WorkbenchSortKey =
  | "weight"
  | "name"
  | "expiry"
  | "traffic"
  | "completeness"
  | "risk";

export type ExpiryBucket = "expired" | "soon" | "month" | "later" | "unknown";
export type TrafficForecastStatus = "unlimited" | "idle" | "ok" | "warning" | "critical" | "exhausted";
export type PingState = "unbound" | "disabled" | "unknown" | "no-data" | "warning" | "critical" | "ok";

export interface VpsWorkbenchNodeInput {
  meta: NodeInfo;
  online: boolean | null;
  updatedAt: number;
  trafficUp: number;
  trafficDown: number;
  netUp: number;
  netDown: number;
  hasPingBinding: boolean;
  includeAgentVersion?: boolean;
  ping?: PingOverviewItem;
  now?: number;
}

export interface CompletenessItem {
  key: string;
  label: string;
  complete: boolean;
}

export interface CompletenessResult {
  complete: number;
  total: number;
  ratio: number;
  missing: CompletenessItem[];
  items: CompletenessItem[];
}

export interface TrafficForecast {
  status: TrafficForecastStatus;
  used: number;
  limit: number;
  remaining: number;
  fraction: number;
  burnRate: number;
  exhaustInSeconds: number | null;
}

export interface PingHealth {
  state: PingState;
  label: string;
  detail: string;
}

export interface VpsWorkbenchNode {
  uuid: string;
  name: string;
  group: string;
  region: string;
  weight: number;
  online: boolean | null;
  expireDays: number | null;
  expiryBucket: ExpiryBucket;
  completeness: CompletenessResult;
  traffic: TrafficForecast;
  ping: PingHealth;
  risks: VpsRisk[];
  riskSeverity: "critical" | "warning" | "none";
}

function hasText(value: unknown) {
  return String(value ?? "").trim() !== "";
}

function hasRenewalInfo(meta: NodeInfo) {
  return formatRenewalPrice(meta) != null;
}

export function getConfigCompleteness(
  meta: NodeInfo,
  hasPingBinding: boolean,
  options: { includeAgentVersion?: boolean } = {},
): CompletenessResult {
  const items: CompletenessItem[] = [
    { key: "region", label: "地区", complete: hasText(meta.region) },
    { key: "group", label: "分组", complete: hasText(meta.group) },
    { key: "price", label: "价格", complete: hasRenewalInfo(meta) },
    { key: "billing", label: "周期", complete: hasText(meta.billing_cycle) },
    { key: "expiry", label: "到期", complete: getExpireDaysRemaining(meta.expired_at) != null },
    { key: "traffic", label: "流量额度", complete: meta.traffic_limit > 0 },
    { key: "ping", label: "Ping 绑定", complete: hasPingBinding },
  ];
  if (options.includeAgentVersion) {
    items.push({ key: "agent", label: "Agent 版本", complete: hasText(meta.version) });
  }
  const complete = items.filter((item) => item.complete).length;
  return {
    complete,
    total: items.length,
    ratio: items.length > 0 ? complete / items.length : 1,
    missing: items.filter((item) => !item.complete),
    items,
  };
}

export function getExpiryBucket(days: number | null): ExpiryBucket {
  if (days == null) return "unknown";
  if (days < 0) return "expired";
  if (days <= 7) return "soon";
  if (days <= 30) return "month";
  return "later";
}

export function getTrafficForecast({
  trafficLimitType,
  trafficUp,
  trafficDown,
  netUp,
  netDown,
  trafficLimit,
}: {
  trafficLimitType: string | null | undefined;
  trafficUp: number;
  trafficDown: number;
  netUp: number;
  netDown: number;
  trafficLimit: number;
}): TrafficForecast {
  const usage = resolveTrafficUsage(trafficLimitType, trafficUp, trafficDown, trafficLimit);
  if (usage.unlimited) {
    return {
      status: "unlimited",
      used: usage.used,
      limit: usage.limit,
      remaining: usage.remaining,
      fraction: usage.fraction,
      burnRate: 0,
      exhaustInSeconds: null,
    };
  }

  const burnRate = computeTrafficUsed(trafficLimitType, netUp, netDown);
  const exhaustInSeconds = burnRate > 0 ? usage.remaining / burnRate : null;
  const status: TrafficForecastStatus =
    usage.remaining <= 0
      ? "exhausted"
      : usage.fraction >= 0.9 || (exhaustInSeconds != null && exhaustInSeconds <= 7 * 86400)
        ? "critical"
        : usage.fraction >= 0.8 || (exhaustInSeconds != null && exhaustInSeconds <= 30 * 86400)
          ? "warning"
          : burnRate <= 0
            ? "idle"
            : "ok";

  return {
    status,
    used: usage.used,
    limit: usage.limit,
    remaining: usage.remaining,
    fraction: usage.fraction,
    burnRate,
    exhaustInSeconds,
  };
}

export function getPingHealth({
  hasPingBinding,
  capabilityPing,
  ping,
}: {
  hasPingBinding: boolean;
  capabilityPing: boolean | null;
  ping?: PingOverviewItem;
}): PingHealth {
  if (!hasPingBinding) {
    return { state: "unbound", label: "未绑定", detail: "首页未分配 Ping 任务" };
  }
  if (capabilityPing === false) {
    return { state: "disabled", label: "不可用", detail: "agent 未启用 Ping 能力" };
  }
  if (!ping || !ping.isAssigned) {
    return { state: "unknown", label: "未知", detail: "等待 Ping 数据" };
  }
  if (ping.values.length === 0) {
    return { state: "no-data", label: "无数据", detail: "已绑定但最近没有样本" };
  }
  const loss = ping.loss ?? 0;
  if (loss >= 20) {
    return { state: "critical", label: "高丢包", detail: `丢包 ${formatPacketLoss(loss)}` };
  }
  if (loss >= 5) {
    return { state: "warning", label: "丢包偏高", detail: `丢包 ${formatPacketLoss(loss)}` };
  }
  if (ping.lastValue != null && ping.lastValue >= 1000) {
    return { state: "critical", label: "高延迟", detail: formatLatency(ping.lastValue) };
  }
  if (ping.lastValue != null && ping.lastValue >= 300) {
    return { state: "warning", label: "延迟偏高", detail: formatLatency(ping.lastValue) };
  }
  return {
    state: "ok",
    label: "正常",
    detail: ping.lastValue != null ? formatLatency(ping.lastValue) : "样本正常",
  };
}

export function buildVpsWorkbenchNode(input: VpsWorkbenchNodeInput): VpsWorkbenchNode {
  const meta = input.meta;
  const expireDays = getExpireDaysRemaining(meta.expired_at);
  const risks = getVpsOperationalRisks({
    uuid: meta.uuid,
    online: input.online,
    updatedAt: input.updatedAt,
    trafficUp: input.trafficUp,
    trafficDown: input.trafficDown,
    trafficLimit: meta.traffic_limit,
    trafficLimitType: meta.traffic_limit_type,
    expiredAt: meta.expired_at,
    capabilityPing: meta.capability_ping,
    hasPingBinding: input.hasPingBinding,
    now: input.now,
  });

  return {
    uuid: meta.uuid,
    name: meta.name.trim() || meta.uuid,
    group: String(meta.group || "").trim(),
    region: String(meta.region || "").trim(),
    weight: meta.weight,
    online: input.online,
    expireDays,
    expiryBucket: getExpiryBucket(expireDays),
    completeness: getConfigCompleteness(meta, input.hasPingBinding, {
      includeAgentVersion: input.includeAgentVersion,
    }),
    traffic: getTrafficForecast({
      trafficLimitType: meta.traffic_limit_type,
      trafficUp: input.trafficUp,
      trafficDown: input.trafficDown,
      netUp: input.netUp,
      netDown: input.netDown,
      trafficLimit: meta.traffic_limit,
    }),
    ping: getPingHealth({
      hasPingBinding: input.hasPingBinding,
      capabilityPing: meta.capability_ping,
      ping: input.ping,
    }),
    risks,
    riskSeverity: risks.length > 0 ? strongestRiskSeverity(risks) : "none",
  };
}

export function searchWorkbenchNode(node: VpsWorkbenchNode, meta: NodeInfo, keyword: string) {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return true;
  return [
    node.name,
    node.uuid,
    node.group,
    node.region,
    meta.tags,
    meta.public_remark,
    meta.os,
    meta.version,
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

function expirySortValue(node: VpsWorkbenchNode) {
  return node.expireDays == null ? Number.POSITIVE_INFINITY : node.expireDays;
}

function riskSortValue(node: VpsWorkbenchNode) {
  if (node.riskSeverity === "critical") return 0;
  if (node.riskSeverity === "warning") return 1;
  return 2;
}

export function sortWorkbenchNodes(nodes: VpsWorkbenchNode[], sortKey: WorkbenchSortKey) {
  return [...nodes].sort((left, right) => {
    switch (sortKey) {
      case "name":
        return left.name.localeCompare(right.name, "zh-CN") || left.weight - right.weight;
      case "expiry":
        return expirySortValue(left) - expirySortValue(right) || left.weight - right.weight;
      case "traffic":
        return right.traffic.fraction - left.traffic.fraction || left.weight - right.weight;
      case "completeness":
        return left.completeness.ratio - right.completeness.ratio || left.weight - right.weight;
      case "risk":
        return riskSortValue(left) - riskSortValue(right) || left.weight - right.weight;
      case "weight":
      default:
        return left.weight - right.weight || left.name.localeCompare(right.name, "zh-CN");
    }
  });
}

export function summarizeWorkbench(nodes: VpsWorkbenchNode[]) {
  return {
    total: nodes.length,
    incomplete: nodes.filter((node) => node.completeness.ratio < 1).length,
    expired: nodes.filter((node) => node.expiryBucket === "expired").length,
    dueSoon: nodes.filter((node) => node.expiryBucket === "soon").length,
    dueMonth: nodes.filter((node) => node.expiryBucket === "month").length,
    trafficPressure: nodes.filter(
      (node) =>
        node.traffic.status === "warning" ||
        node.traffic.status === "critical" ||
        node.traffic.status === "exhausted",
    ).length,
    pingAttention: nodes.filter(
      (node) =>
        node.ping.state === "disabled" ||
        node.ping.state === "no-data" ||
        node.ping.state === "warning" ||
        node.ping.state === "critical",
    ).length,
  };
}
