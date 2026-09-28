import type { NetworkResult } from "@/services/networkObservatory";
export type NetworkMeasurement = { label: string; value: number; unit: string };
export type NetworkHop = { ttl: number; address: string; asn: string; rtt: number | null };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
export function cleanNetworkOutput(value: string) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r(?!\n)/g, "\n");
}
export function parseNetworkReport(result: Pick<NetworkResult, "mode" | "rawOutput">): { measurements: NetworkMeasurement[]; hops: NetworkHop[]; note: string } {
  const raw = cleanNetworkOutput(result.rawOutput), measurements: NetworkMeasurement[] = [], hops: NetworkHop[] = [];
  let note = "";
  if (result.mode === "https") {
    const values: Record<string, number> = {};
    for (const match of raw.matchAll(/\b(status|dns_seconds|connect_seconds|tls_seconds|ttfb_seconds)=([0-9]+(?:\.[0-9]+)?)/g)) values[match[1]] = Number(match[2]);
    if (values.status > 0) measurements.push({ label: "HTTP 状态", value: values.status, unit: "" });
    if (finite(values.dns_seconds)) measurements.push({ label: "DNS", value: values.dns_seconds * 1000, unit: "ms" });
    if (finite(values.connect_seconds)) measurements.push({ label: finite(values.dns_seconds) ? "TCP 建连" : "连接累计", value: Math.max(0, values.connect_seconds - (values.dns_seconds || 0)) * 1000, unit: "ms" });
    if (finite(values.tls_seconds) && values.tls_seconds >= values.connect_seconds) measurements.push({ label: "TLS 握手", value: (values.tls_seconds - values.connect_seconds) * 1000, unit: "ms" });
    if (finite(values.ttfb_seconds)) measurements.push({ label: "首字节累计", value: values.ttfb_seconds * 1000, unit: "ms" });
    note = "探测网站根路径。首字节为从请求开始计时的累计耗时；新版探测器使用 HEAD，不下载正文。";
  } else if (result.mode === "throughput" || result.mode === "route") {
    let parsed: Record<string, unknown> = {};
    try { parsed = object(JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1))); } catch { /* Preserve the report when a tool changes its format. */ }
    if (result.mode === "throughput") {
      const end = object(parsed.end), received = object(end.sum_received), sent = object(end.sum_sent);
      if (finite(received.bits_per_second)) measurements.push({ label: "上传吞吐（接收端）", value: received.bits_per_second / 1e6, unit: "Mbps" });
      if (finite(sent.retransmits)) measurements.push({ label: "TCP 重传", value: sent.retransmits, unit: "次" });
      if (finite(sent.bytes)) measurements.push({ label: "上传数据", value: sent.bytes / 1e6, unit: "MB" });
      if (finite(sent.seconds)) measurements.push({ label: "持续时间", value: sent.seconds, unit: "s" });
      note = "10 秒单连接上传，结果取决于本机、路径和服务端；此项目没有测量下载速度。";
    } else {
      // NextTrace's traditional JSON exports time.Duration RTT in nanoseconds.
      const rows = Array.isArray(parsed.Hops) ? parsed.Hops : [];
      for (const [index, probes] of rows.entries()) {
        const values = Array.isArray(probes) ? probes : [probes];
        const hop = object(values.find((entry) => object(entry).Success === true) || values[0]);
        const address = object(hop.Address), geo = object(hop.Geo);
        hops.push({ ttl: finite(hop.TTL) ? hop.TTL : index + 1, address: typeof address.IP === "string" ? address.IP : typeof hop.Address === "string" ? hop.Address : "未响应", asn: typeof geo.Asnumber === "string" ? geo.Asnumber : "", rtt: finite(hop.RTT) ? hop.RTT / 1e6 : null });
      }
      note = "中间跳不回应不等于终点丢包；运营商标签表示目标分类，不是对整条线路的评级。";
    }
  } else note = "按本地 TcpQuality 版本保留完整报告。执行完成表示脚本已结束，网络表现请结合报告中的各项目判断。";
  return { measurements, hops, note };
}
