import { trimFixed } from "@/utils/format";

const COMPACT_TRAFFIC_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

// 对齐 Komari 后端的 computeUsedByType(utils/notifier/traffic.go):配置的流量上限阈值会拿
// 节点累计上/下行总量的这几种归约之一来比较。后端会把 type 转小写,空/未知值落到 "max"
// (gorm 默认 'max')。
export interface TrafficDisplay {
  /** used / limit,夹到 0..1(无限时为 0)。 */
  fraction: number;
  /** 条的热力色(用量上升时绿 → 红)。 */
  color: string;
  /** "12.4 GB" 或 "∞" —— 大卡片上紧挨标签内联显示。 */
  remainingLabel: string;
  /** "64.3 GB / 4.00 TB" 或 "2.73 GB / ∞" —— used/limit 那一行。 */
  detail: string;
  /** "64.3/500 GB" 或 "8.05 MB/500 GB" —— 小卡片的紧凑 used/limit。 */
  compactDetail: string;
  /** 上限类型的可读标签,如 "上下取大" —— 给 tooltip 用。 */
  typeLabel: string;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 按节点的 `traffic_limit_type` 从累计上/下行总量算出已用流量。默认(空/未知)为 "max",与后端一致。
 */
export function computeTrafficUsed(
  type: string | null | undefined,
  up: number,
  down: number,
): number {
  const safeUp = nonNegative(up);
  const safeDown = nonNegative(down);
  switch ((type ?? "").trim().toLowerCase()) {
    case "up":
      return safeUp;
    case "down":
      return safeDown;
    case "sum":
      return safeUp + safeDown;
    case "min":
      return Math.min(safeUp, safeDown);
    case "max":
    default:
      return Math.max(safeUp, safeDown);
  }
}

export interface TrafficUsage {
  /** 按 traffic_limit_type 归约后的累计"已用"量。 */
  used: number;
  limit: number;
  /** 没配置正的上限(limit ≤ 0)时为 true。 */
  unlimited: boolean;
  /** max(0, limit − used);无限时为 0。 */
  remaining: number;
  /** used / limit 夹到 0..1;无限时为 0。 */
  fraction: number;
}

function byteUnitIndex(value: number) {
  let index = 0;
  let current = Math.max(0, Number.isFinite(value) ? value : 0);
  while (current >= 1024 && index < COMPACT_TRAFFIC_UNITS.length - 1) {
    current /= 1024;
    index += 1;
  }
  return index;
}

function compactByteValue(value: number) {
  if (value >= 100) return Math.round(value).toString();
  if (value >= 10) return trimFixed(value, 1);
  if (value >= 0.01) return trimFixed(value, 2);
  if (value > 0) return trimFixed(value, 3);
  return "0";
}

function compactByteParts(value: number) {
  const unitIndex = byteUnitIndex(value);
  return {
    value: compactByteValue(value / 1024 ** unitIndex),
    unit: COMPACT_TRAFFIC_UNITS[unitIndex],
    unitIndex,
  };
}

export function formatCompactTrafficDetail(usage: TrafficUsage) {
  const used = compactByteParts(usage.used);
  if (usage.unlimited) return `${used.value} ${used.unit}/∞`;

  const limit = compactByteParts(usage.limit);
  if (used.unitIndex === limit.unitIndex) {
    return `${used.value}/${limit.value} ${used.unit}`;
  }
  return `${used.value} ${used.unit}/${limit.value} ${limit.unit}`;
}

// 共享的流量模型——首页卡片(useNodeCardModel)和实例详情页共用的 used/remaining/fraction 唯一来源,
// 让 traffic_limit_type 的语义到处保持一致。
export function resolveTrafficUsage(
  type: string | null | undefined,
  up: number,
  down: number,
  limit: number,
): TrafficUsage {
  const used = computeTrafficUsed(type, up, down);
  const unlimited = !(limit > 0);
  const remaining = unlimited ? 0 : Math.max(0, limit - used);
  const fraction = unlimited ? 0 : Math.max(0, Math.min(1, used / limit));
  return { used, limit, unlimited, remaining, fraction };
}

export function trafficTypeLabel(type: string | null | undefined): string {
  switch ((type ?? "").trim().toLowerCase()) {
    case "up":
      return "仅上行";
    case "down":
      return "仅下行";
    case "sum":
      return "上行+下行";
    case "min":
      return "上下取小";
    case "max":
    default:
      return "上下取大";
  }
}
