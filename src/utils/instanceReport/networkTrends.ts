import type { EvidenceValue, NetworkEvidence, NetworkTrend } from "./model";
import routeRules from "../../../network-observatory/plugin/src/route-networks.json";

const obj = (value: EvidenceValue | undefined): { [key: string]: EvidenceValue } =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const finite = (value: EvidenceValue | undefined) => typeof value === "number" && Number.isFinite(value) ? value : null;
const moduleNames: Record<string, string> = { routes: "三网线路", "china-speed": "三网测速", international: "国际连通", "international-speed": "国际测速", "tcp-quality": "TCP 质量", "tcpquality-full": "TcpQuality 完整检测", "nodequality-full": "NodeQuality 完整检测", idc: "IDC 互联", bgp: "BGP / RPKI" };

/** Observations remain separated by source, address family, target and direction. */
export function networkTrends(items: NetworkEvidence[]): NetworkTrend[] {
  const groups = new Map<string, NetworkTrend>();
  const identities = new Map<string, string>();
  const failures = new Map<string, { t: number; v: null; state: string }[]>();
  const add = (key: string, title: string, module: string, unit: string, kind: NetworkTrend["kind"], point: NetworkTrend["points"][number]) => {
    let group = groups.get(key);
    if (!group) { group = { title, module, unit, kind, points: [] }; groups.set(key, group); }
    group.points.push(point);
  };
  for (const item of items) {
    if (!Number.isFinite(item.time)) continue;
    const status = ({ ok: "成功", complete: "成功", application: "应用响应", partial: "部分", failed: "失败", missing: "缺测", cancelled: "取消", running: "进行中" } as Record<string, string>)[item.state] || "未知";
    add(`status:${item.module}`, `${moduleNames[item.module] || item.module} · 检测状态`, item.module, "状态", "category", { t: item.time, v: null, label: status, state: item.state });
    const data = obj(item.detail), tcp = obj(data.tcpQuality), timings = obj(data.timingsMs), https = obj(data.https);
    const parts = [moduleNames[item.module] || item.module, item.family ? `IPv${item.family}` : "", item.city, item.carrier, item.provider, item.direction, item.protocol, typeof data.method === "string" ? data.method : "", item.targetRef].filter(Boolean);
    const base = JSON.stringify(parts), heading = parts.join(" · ");
    const identity = JSON.stringify([item.module, item.family, item.city, item.carrier, item.provider, item.direction, item.protocol, item.targetRef]);
    if (["failed", "missing", "cancelled"].includes(item.state)) {
      const rows = failures.get(identity) || []; rows.push({ t: item.time, v: null, state: item.state }); failures.set(identity, rows);
    }
    const metric = (suffix: string, label: string, unit: string, value: EvidenceValue | undefined, scale = 1) => {
      const n = finite(value);
      if (n != null && n >= 0) { const key = `${base}:${suffix}`; identities.set(key, identity); add(key, `${heading} · ${label}`, item.module, unit, "number", { t: item.time, v: n * scale, state: item.state }); }
    };
    if (item.module === "routes") {
      const route = obj(data.routeEvidence);
      let labels = Array.isArray(route.headlineLabels) ? route.headlineLabels.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
      // Older retained summaries may contain only AS paths. Reuse the same
      // observed-AS rules; absent prefix evidence cannot be reconstructed.
      if (!labels.length && Array.isArray(data.asPath)) {
        const asns = data.asPath.flatMap(v => String(v).replace(/\bAS(?=\d)/gi, "").split(/[\s,/{}]+/));
        labels = [...new Set(asns.flatMap(asn => routeRules.networks.filter(rule => rule.asn === asn).map(rule => rule.label)))];
      }
      if (labels.length) add(`${base}:route`, heading, item.module, "线路", "category", { t: item.time, v: null, label: labels.join(" / "), state: item.state });
    }
    for (const [key, label, unit] of [["avgMs", "平均时延", "ms"], ["medianMs", "中位时延", "ms"], ["minMs", "最小时延", "ms"], ["maxMs", "最大时延", "ms"], ["stdevMs", "时延标准差", "ms"], ["jitterMs", "抖动", "ms"], ["failurePercent", "失败率", "%"], ["lossPercent", "丢包率", "%"]] as const) {
      metric(key, label, unit, tcp[key] ?? data[key]);
    }
    for (const [key, label] of [["dns", "DNS"], ["connect", "连接"], ["tls", "TLS"], ["ttfb", "首字节"], ["total", "总耗时"]] as const)
      metric(`https-${key}`, label, "ms", timings[key] ?? obj(https.timingsMs)[key]);
    if (Array.isArray(data.runs)) for (const entry of data.runs) {
      const run = obj(entry), direction = typeof run.vpsDirection === "string" ? run.vpsDirection : typeof run.direction === "string" ? run.direction : "方向未知";
      const connections = typeof run.streams === "number" ? `${run.streams} 连接` : "连接数未知";
      const runId = `${direction}:${connections}`;
      const text = `${direction === "download" ? "VPS 下载" : direction === "upload" ? "VPS 上传" : direction} · ${connections}`;
      if (typeof run.state === "string" && !["ok", "partial"].includes(run.state)) {
        const key = `${base}:speed:${runId}`; identities.set(key, identity);
        add(key, `${heading} · ${text} · 速率`, item.module, "Mbps", "number", { t: item.time, v: null, state: run.state });
        continue;
      }
      metric(`speed:${runId}`, `${text} · 速率`, "Mbps", run.bitsPerSecond, 1 / 1e6);
      metric(`peak:${runId}`, `${text} · 测得最高速率`, "Mbps", run.maxBitsPerSecond, 1 / 1e6);
      metric(`rtt:${runId}`, `${text} · TCP RTT`, "ms", run.tcpRttMs);
      metric(`retransmits:${runId}`, `${text} · 重传`, "次", run.retransmits);
    }
    const http = finite(https.httpStatus ?? data.httpStatus);
    if (http != null) add(`${base}:http`, `${heading} · HTTP 状态`, item.module, "状态", "category", { t: item.time, v: null, label: String(http), state: item.state });
    if (item.module === "bgp" && Array.isArray(data.originAsns) && data.originAsns.length)
      add(`${base}:origin`, `${heading} · 起源 AS`, item.module, "AS", "category", { t: item.time, v: null, label: data.originAsns.map(String).join(" / "), state: item.state });
    if (item.module === "bgp" && Array.isArray(data.paths)) for (const entry of data.paths) {
      const path = obj(entry);
      if (!Array.isArray(path.path) || !path.path.length) continue;
      const source = [path.source, path.collector, path.peer].filter(v => typeof v === "string" && v).join(" · ");
      add(`${base}:path:${source}`, `${heading} · AS 路径${source ? ` · ${source}` : ""}`, item.module, "AS 路径", "category", { t: item.time, v: null, label: path.path.map(String).join(" → "), state: item.state });
    }
    if (item.module === "bgp" && Array.isArray(data.rpki)) for (const entry of data.rpki) {
      const row = obj(entry), asn = typeof row.asn === "string" || typeof row.asn === "number" ? String(row.asn) : "未知";
      if (typeof row.state === "string") add(`${base}:rpki:${asn}`, `${heading} · AS${asn} RPKI`, item.module, "RPKI", "category", { t: item.time, v: null, label: row.state, state: item.state });
    }
  }
  return [...groups.entries()].map(([key, group]) => {
    const missing = failures.get(identities.get(key) || "") || [];
    const times = new Set(group.points.map(p => p.t));
    return { ...group, points: [...group.points, ...missing.filter(p => !times.has(p.t))].sort((a, b) => a.t - b.t) };
  });
}
