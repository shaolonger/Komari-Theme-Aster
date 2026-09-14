import { formatBytes, getExpireDaysRemaining } from "@/utils/format";
import { resolveTrafficUsage } from "@/utils/traffic";

export type VpsRiskKind = "status" | "expiry" | "traffic" | "ping";
export type VpsRiskSeverity = "critical" | "warning";

export interface VpsRiskInput {
  uuid: string;
  online: boolean | null;
  updatedAt: number;
  trafficUp: number;
  trafficDown: number;
  trafficLimit: number;
  trafficLimitType: string | null | undefined;
  expiredAt: string | number | null | undefined;
  capabilityPing: boolean | null;
  hasPingBinding: boolean;
  now?: number;
}

export interface VpsRisk {
  uuid: string;
  kind: VpsRiskKind;
  severity: VpsRiskSeverity;
  title: string;
  detail: string;
}

export const STALE_REPORT_MS = 3 * 60 * 1000;
export const EXPIRY_WARNING_DAYS = 15;
export const TRAFFIC_WARNING_FRACTION = 0.8;
export const TRAFFIC_CRITICAL_FRACTION = 0.9;

function formatExpiryDetail(days: number) {
  if (days < 0) return "已过期";
  if (days === 0) return "今日到期";
  return `${days} 天后到期`;
}

function trafficRiskTitle(fraction: number) {
  if (fraction >= 1) return "流量已用尽";
  if (fraction >= TRAFFIC_CRITICAL_FRACTION) return "流量接近上限";
  return "流量使用偏高";
}

export function getVpsOperationalRisks(input: VpsRiskInput): VpsRisk[] {
  const risks: VpsRisk[] = [];
  const now = input.now ?? Date.now();

  if (input.online === false) {
    risks.push({
      uuid: input.uuid,
      kind: "status",
      severity: "critical",
      title: "节点离线",
      detail: "当前没有实时上报",
    });
  } else if (
    input.online === true &&
    input.updatedAt > 0 &&
    now - input.updatedAt > STALE_REPORT_MS
  ) {
    const minutes = Math.max(1, Math.floor((now - input.updatedAt) / 60_000));
    risks.push({
      uuid: input.uuid,
      kind: "status",
      severity: "warning",
      title: "上报延迟",
      detail: `${minutes} 分钟未收到新数据`,
    });
  }

  const expireDays = getExpireDaysRemaining(input.expiredAt, now);
  if (expireDays != null && expireDays <= EXPIRY_WARNING_DAYS) {
    risks.push({
      uuid: input.uuid,
      kind: "expiry",
      severity: expireDays <= 3 ? "critical" : "warning",
      title: expireDays < 0 ? "节点已过期" : "节点即将到期",
      detail: formatExpiryDetail(expireDays),
    });
  }

  const traffic = resolveTrafficUsage(
    input.trafficLimitType,
    input.trafficUp,
    input.trafficDown,
    input.trafficLimit,
  );
  if (!traffic.unlimited && traffic.fraction >= TRAFFIC_WARNING_FRACTION) {
    risks.push({
      uuid: input.uuid,
      kind: "traffic",
      severity: traffic.fraction >= TRAFFIC_CRITICAL_FRACTION ? "critical" : "warning",
      title: trafficRiskTitle(traffic.fraction),
      detail: `${formatBytes(traffic.used)} / ${formatBytes(traffic.limit)}`,
    });
  }

  if (input.hasPingBinding && input.capabilityPing === false) {
    risks.push({
      uuid: input.uuid,
      kind: "ping",
      severity: "warning",
      title: "Ping 任务不可用",
      detail: "首页已绑定 Ping，但 agent 未启用 Ping 能力",
    });
  }

  return risks;
}

export function strongestRiskSeverity(risks: VpsRisk[]) {
  return risks.some((risk) => risk.severity === "critical") ? "critical" : "warning";
}
