export interface ReportRange {
  start: number;
  end: number;
  timeZone: string;
}
export interface ReportPoint {
  t: number;
  v: number | null;
  n?: number;
}
export type SourceState =
  | "available"
  | "partial"
  | "empty"
  | "unavailable"
  | "forbidden"
  | "failed";
export interface ReportSource {
  id: string;
  name: string;
  state: SourceState;
  detail: string;
}
export interface ReportMetric {
  key: string;
  label: string;
  unit: string;
  points: ReportPoint[];
  precision: "返回点" | "聚合桶均值" | "计数器末值";
  capacity?: number;
  provenance?: {
    metricKey: string;
    aggregation: string;
    downsampled: boolean | null;
    intervalSeconds: number | null;
    retentionDays: number | null;
    deviceIndex: string;
    deviceName: string;
  };
}
export interface ReportPing {
  id: number;
  name: string;
  protocol: string;
  target: string;
  interval: number;
  points: (ReportPoint & { sent: number; lost: number; valid: number })[];
}
export type EvidenceValue =
  | string
  | number
  | boolean
  | null
  | EvidenceValue[]
  | { [key: string]: EvidenceValue };
export interface NetworkEvidence {
  id: string;
  module: string;
  time: number;
  startedAt?: number;
  state: string;
  target: string;
  direction: string;
  source: string;
  detail: EvidenceValue;
  summaryOnly?: boolean;
}
export interface ReportNode {
  uuid: string;
  name: string;
  fields: [string, string][];
  memory: number;
  disk: number;
  swap: number;
  cores: number;
  ip: string[];
  trafficLimit: number;
  trafficRule: string;
  snapshot: {
    online: boolean | null;
    uptime: number | null;
    updatedAt: number | null;
  };
}
export interface ReportInput {
  schemaVersion: 1;
  reportId: string;
  generatedAt: number;
  range: ReportRange;
  theme: "light" | "dark";
  showAddresses: boolean;
  backend: string;
  node: ReportNode;
  sources: ReportSource[];
  metrics: ReportMetric[];
  pings: ReportPing[];
  network: NetworkEvidence[];
  previous?: {
    range: ReportRange;
    metrics: ReportMetric[];
    pings: ReportPing[];
    sources: ReportSource[];
  };
}
export interface MetricStats {
  count: number;
  mean: number | null;
  min: number | null;
  max: number | null;
  p95: number | null;
  first: number | null;
  last: number | null;
  coveredMs: number;
  intervalMs: number;
  gaps: { start: number; end: number }[];
}
export interface PingStats {
  sent: number;
  lost: number;
  valid: number;
  mean: number | null;
  loss: number | null;
}
export interface TrafficStats {
  up: number | null;
  down: number | null;
  partial: boolean;
  resets: number;
  daily: { date: string; up: number | null; down: number | null }[];
}
export interface ReportFinding {
  chapter: string;
  severity: "info" | "warning";
  title: string;
  detail: string;
  time?: number;
}
export interface ReportModel extends ReportInput {
  stats: Record<string, MetricStats>;
  pingStats: Record<number, PingStats>;
  traffic: TrafficStats;
  findings: ReportFinding[];
  previousStats?: Record<string, MetricStats>;
  previousPingStats?: Record<number, PingStats>;
  rules: { cpu: number; memory: number; disk: number; version: string };
}

export const METRIC_FIELDS = [
  ["cpu", "CPU", "%", "cpu.usage"],
  ["ram", "内存", "B", "memory.used"],
  ["swap", "Swap", "B", "swap.used"],
  ["load", "Load 1", "", "load.average"],
  ["disk", "磁盘占用", "B", "disk.used"],
  ["net_in", "下载速率", "B/s", "net.in.rate"],
  ["net_out", "上传速率", "B/s", "net.out.rate"],
  ["net_total_up", "累计上传", "B", "net.total.up"],
  ["net_total_down", "累计下载", "B", "net.total.down"],
  ["process", "进程", "个", "process.count"],
  ["connections", "TCP 连接", "个", "connections.tcp"],
  ["connections_udp", "UDP 连接", "个", "connections.udp"],
  ["gpu", "GPU 平均使用率", "%", "gpu.usage"],
  ["gpu_device", "GPU 设备使用率", "%", "gpu.device.usage"],
  ["gpu_memory", "GPU 显存使用", "B", "gpu.memory.used"],
  ["gpu_memory_total", "GPU 显存容量", "B", "gpu.memory.total"],
  ["temp", "温度", "°C", "gpu.temperature"],
  ["traffic_delta_up", "上报上传增量", "B", "traffic.up"],
  ["traffic_delta_down", "上报下载增量", "B", "traffic.down"],
] as const;
export const CHAPTERS = [
  ["overview", "报告概览"],
  ["resources", "性能资源"],
  ["network", "网络质量"],
  ["traffic", "带宽流量"],
  ["stability", "运行稳定性"],
  ["assets", "配置资产"],
  ["events", "事件建议"],
  ["sources", "数据口径"],
] as const;

export function timestamp(value: unknown): number {
  if (typeof value === "number")
    return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : NaN;
  return typeof value === "string" ? Date.parse(value) : NaN;
}
export function validateReportRange(range: ReportRange, now: number) {
  if (
    !Number.isFinite(range.start) ||
    !Number.isFinite(range.end) ||
    range.end <= range.start
  )
    throw new Error("请选择有效日期，结束时间须晚于开始时间。");
  if (range.end > now) throw new Error("结束时间不能晚于当前时间。");
  if (range.end - range.start > 366 * 86400000)
    throw new Error("单份报告最长支持 366 天，请缩小日期范围。");
  new Intl.DateTimeFormat("en", { timeZone: range.timeZone });
}

export function throwIfReportAborted(signal: AbortSignal) {
  if (signal.aborted)
    throw signal.reason ?? new DOMException("已取消", "AbortError");
}
