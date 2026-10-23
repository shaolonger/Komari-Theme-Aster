import type { ReportHop, ReportMeasurement } from "@/services/reportObservatory";
import { hopIdentity, numberText } from "./reportMetrics";
import { formatNetworkTime } from "./shared";

export function RouteHopIdentity({ hop }: { hop: ReportHop }) {
  return (
    <div className="report-hop-identity">
      <div className="report-hop-title">
        <strong>{hopIdentity(hop)}</strong>
        {hop.whois && <span className="report-hop-whois">{hop.whois}</span>}
      </div>
      {hop.network && <small>{hop.network}</small>}
      {hop.location && <small>位置库标注：{hop.location}</small>}
      {hop.domain && <small className="report-hop-domain">{hop.domain}</small>}
      {hop.hostname && hop.hostname !== hop.domain && <small>PTR：{hop.hostname}</small>}
      {(hop.asnSource || hop.geoSource || hop.registryCountry) && (
        <details className="report-hop-sources">
          <summary>信息来源</summary>
          {hop.asnSource && <small>ASN：{hop.asnSource}{hop.asnQueriedAt ? ` · ${formatNetworkTime(hop.asnQueriedAt)}` : ""}</small>}
          {hop.geoSource && <small>元数据：{hop.geoSource}{hop.geoQueriedAt ? ` · ${formatNetworkTime(hop.geoQueriedAt)}` : ""}</small>}
          {hop.geoStatus === "lookup-failed" && <small>元数据查询失败或超时</small>}
          {hop.registryCountry && <small>登记国家：{hop.registryCountry}（不代表跳点位置）</small>}
          {hop.prefix && <small>来源地址段：{hop.prefix}</small>}
        </details>
      )}
    </div>
  );
}

export function RoutePathSummary({ hops }: { hops: ReportHop[] }) {
  const asPath: string[] = [];
  for (const hop of hops) {
    const label = hop.asn ? "AS" + hop.asn.replace(/\bAS/g, "").replace(/ \/ /g, " / AS") : "未知";
    if (asPath.at(-1) !== label) asPath.push(label);
  }
  const locations = [...new Set(hops.map(h => h.location).filter(Boolean))];
  if (!hops.length) return null;
  return (
    <div className="report-route-summary">
      <p><span>已观测 AS 序列</span>{asPath.join(" → ")}</p>
      {!!locations.length && <p><span>已知位置标签</span>{locations.join("；")}</p>}
      <small>AS 序列由逐跳 IP 归属整理；位置来自信息库，仅供参考，不代表已验证的物理路径。</small>
    </div>
  );
}

const observationLabels: Record<string, string> = {
  ok: "已采集", empty: "未匹配到元数据", failed: "补充失败", missing: "未安装 NextTrace",
  disabled: "未启用", cancelled: "已取消",
};
export function RouteMetadataObservation({ data }: { data: ReportMeasurement["data"] }) {
  const observation = data.metadataObservation;
  if (!observation) return <p className="report-caption">此报告未记录独立 NextTrace 补充诊断；新版探测器重新测量后可查看。</p>;
  const hops = observation.hops || [];
  return (
    <details className="report-metadata-observation">
      <summary>NextTrace 补充观测 · {observationLabels[observation.state || ""] || "旧版诊断"} · 匹配 {observation.matchedIps?.length || 0} 个 IP</summary>
      <p className="report-caption">{observation.conditions || "独立观测，仅按相同 IP 补充元数据；不合并 RTT 或未响应率"}</p>
      <dl className="report-metadata-conditions">
        {(observation.resolvedIp || observation.target) && <><dt>本次目标</dt><dd>{observation.resolvedIp || observation.target}</dd></>}
        {observation.protocol && <><dt>协议与端口</dt><dd>{observation.protocol.toUpperCase()} · {observation.port ?? "—"}</dd></>}
        {(observation.completedAt || observation.queriedAt) && <><dt>采集时间</dt><dd>{formatNetworkTime(observation.completedAt || observation.queriedAt || "")}</dd></>}
        {observation.durationMs !== undefined && <><dt>耗时</dt><dd>{numberText(observation.durationMs)} ms</dd></>}
        {observation.exitCode !== undefined && <><dt>退出码</dt><dd>{observation.exitCode}</dd></>}
      </dl>
      {observation.diagnostic && <p className="report-caption">{observation.diagnostic}</p>}
      {observation.metadataTruncated && <p className="report-caption">较长的元数据字段已节选，以保留完整路径和测量统计。</p>}
      {observation.parseError && observation.parseError !== observation.diagnostic && <p className="report-caption">解析：{observation.parseError}</p>}
      {!!hops.length && <>
        <p className="report-caption">以下为独立 NextTrace 路径，其 RTT 不参与上方 MTR 统计。终点{observation.complete ? "已确认到达" : "未确认到达"}。</p>
        <div className="report-table-scroll">
          <table className="report-mtr-table">
            <thead><tr><th>跳</th><th>ASN / 网络与位置</th><th>IP</th><th>独立 RTT</th></tr></thead>
            <tbody>{hops.map((hop, index) => <tr key={`${hop.ttl}:${index}`}><td>{hop.ttl}</td><td><RouteHopIdentity hop={hop} /></td><td>{hop.address || "*"}</td><td>{numberText(hop.rttMs)} ms</td></tr>)}</tbody>
          </table>
        </div>
      </>}
      {(observation.stdout || observation.stderr) && <details className="report-metadata-raw">
        <summary>NextTrace 原始输出{observation.stdoutTruncated || observation.stderrTruncated ? "（节选）" : ""}</summary>
        {observation.stdout && <><p>标准输出{observation.stdoutTruncated ? "（已截断）" : ""}</p><pre className="report-json">{observation.stdout}</pre></>}
        {observation.stderr && <><p>错误输出{observation.stderrTruncated ? "（已截断）" : ""}</p><pre className="report-json">{observation.stderr}</pre></>}
      </details>}
      {!observation.state && <p className="report-caption">旧版报告未保存退出码、解析状态和原始输出，无法据此确认补充步骤失败原因。</p>}
    </details>
  );
}
