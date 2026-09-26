import type { HomepagePingSourceRow } from "@/utils/homepagePingSources";
import { STALE_REPORT_MS } from "@/utils/vpsRisk";

export type HostHealthStatus = "online" | "offline" | "stale";
export type NetworkHealthStatus = "ok" | "warning" | "critical" | "empty" | "unmonitored";

export function getHostHealthStatus(online: boolean | null | undefined, updatedAt: number, now = Date.now()): HostHealthStatus {
  if (online === false) return "offline";
  if (online !== true || updatedAt <= 0 || now - updatedAt > STALE_REPORT_MS) return "stale";
  return "online";
}

export function getNetworkHealthStatus(rows: Array<Pick<HomepagePingSourceRow, "status">>, hasPingBinding: boolean): NetworkHealthStatus {
  if (!hasPingBinding) return "unmonitored";
  if (rows.length === 0) return "empty";
  if (rows.some((row) => row.status === "critical")) return "critical";
  if (rows.some((row) => row.status === "warning")) return "warning";
  if (rows.some((row) => row.status === "empty")) return "empty";
  return "ok";
}

const HOST_LABEL: Record<HostHealthStatus, string> = {
  online: "在线",
  offline: "离线",
  stale: "上报异常",
};

const NETWORK_LABEL: Record<NetworkHealthStatus, string> = {
  ok: "正常",
  warning: "波动",
  critical: "严重异常",
  empty: "暂无数据",
  unmonitored: "未监测",
};

export function NodeStatusSummary({
  hostStatus,
  networkStatus,
}: {
  hostStatus: HostHealthStatus;
  networkStatus: NetworkHealthStatus;
}) {
  return (
    <div className="node-status-summary" aria-label={`主机状态：${HOST_LABEL[hostStatus]}；网络状态：${NETWORK_LABEL[networkStatus]}`}>
      <span className="node-status-chip" data-kind="host" data-status={hostStatus}>
        <small>主机</small>{HOST_LABEL[hostStatus]}
      </span>
      <span className="node-status-chip" data-kind="network" data-status={networkStatus}>
        <small>网络</small>{NETWORK_LABEL[networkStatus]}
      </span>
    </div>
  );
}
