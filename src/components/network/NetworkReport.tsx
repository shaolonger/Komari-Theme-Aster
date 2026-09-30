import {
  NETWORK_OBSERVATORY_API,
  type NetworkResult,
} from "@/services/networkObservatory";
import { cleanNetworkOutput, parseNetworkReport } from "@/utils/networkReport";
import { formatNetworkTime, modeName } from "./shared";
import { NetworkSpeedTrend } from "./NetworkSpeedTrend";
import { NetworkBadge } from "./NetworkUi";
export function NetworkReport({
  result,
  previous,
  history = [],
}: {
  result: NetworkResult;
  previous?: NetworkResult;
  history?: NetworkResult[];
}) {
  const report = parseNetworkReport(result),
    before = previous ? parseNetworkReport(previous) : null;
  const pathChanged =
    before?.hops.length && report.hops.length
      ? report.hops.map((h) => h.address).join("|") !==
        before.hops.map((h) => h.address).join("|")
      : null;
  return (
    <div className="network-report">
      <div className="network-report-heading">
        <strong>{modeName(result.mode)}</strong>
        <p>{result.target === "default" ? "工具默认目标集" : result.target}</p>
        <div className="native-report-meta">
          <NetworkBadge state={result.status === "success" ? "ok" : "failed"}>
            {result.status === "success"
              ? "执行完成"
              : result.status === "timeout"
                ? "超时"
                : "执行失败"}
          </NetworkBadge>
          <time>{formatNetworkTime(result.completedAt)}</time>
        </div>
        <p>
          {result.status === "success"
            ? "执行完成"
            : result.status === "timeout"
              ? "超时"
              : "执行失败"}{" "}
          · 退出码 {result.exitCode}
        </p>
      </div>
      {Date.now() - Date.parse(result.completedAt) > 86_400_000 && (
        <p className="network-inline-note">
          这是超过 24 小时的历史数据，请结合最新检测判断。
        </p>
      )}
      <div className="network-measurements">
        {report.measurements.map((item) => {
          const old = before?.measurements.find(
            (m) => m.label === item.label && m.unit === item.unit,
          );
          return (
            <div key={item.label}>
              <small>{item.label}</small>
              <strong>
                {item.value.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}{" "}
                <em>{item.unit}</em>
              </strong>
              {old && item.unit && (
                <small>
                  较上次 {item.value - old.value >= 0 ? "+" : ""}
                  {(item.value - old.value).toFixed(2)} {item.unit}
                </small>
              )}
            </div>
          );
        })}
      </div>
      <p className="network-help">{report.note}</p>
      <NetworkSpeedTrend result={result} history={history} />
      {result.reportImages.length > 0 && (
        <div className="network-report-images">
          {result.reportImages.map((section) => (
            <figure key={section}>
              <figcaption>
                {section === "intl"
                  ? "国际互联"
                  : section === "ipv6"
                    ? "三网 IPv6"
                    : "三网 IPv4"}{" "}
                · 已保存图片
              </figcaption>
              <img
                loading="lazy"
                alt={`${modeName(result.mode)} ${section} 检测报告`}
                src={`${NETWORK_OBSERVATORY_API}/reports/${encodeURIComponent(result.nodeUuid)}/${encodeURIComponent(result.taskId || "")}/${section}`}
              />
            </figure>
          ))}
        </div>
      )}
      {["tcpquality-report", "tcpquality-intl-report"].includes(result.mode) &&
        !result.reportImages.length && (
          <p className="network-inline-note">
            未缓存到报告图片。可在完整诊断输出中检查 TcpQuality
            的上传结果；报告服务不可用时仍保留文本。
          </p>
        )}
      {pathChanged !== null && (
        <p>
          与上一条同目标路径相比：
          {pathChanged ? "路径响应有变化" : "逐跳地址一致"}
          （不代表线路质量评级）
        </p>
      )}
      {report.hops.length > 0 && (
        <div className="network-table-scroll">
          <table>
            <thead>
              <tr>
                <th>跳数</th>
                <th>地址</th>
                <th>ASN</th>
                <th>时延</th>
              </tr>
            </thead>
            <tbody>
              {report.hops.map((hop, i) => (
                <tr key={i}>
                  <td>{hop.ttl}</td>
                  <td>{hop.address}</td>
                  <td>{hop.asn || "—"}</td>
                  <td>{hop.rtt === null ? "—" : `${hop.rtt.toFixed(2)} ms`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details
        open={report.measurements.length === 0 && report.hops.length === 0}
        className="network-result-details"
      >
        <summary>完整诊断输出</summary>
        <pre>{cleanNetworkOutput(result.rawOutput) || "没有输出"}</pre>
      </details>
      <small>
        探测器 {result.runnerVersion || "旧版"} · 目标库{" "}
        {result.catalogVersion || "自定义或旧版"}
      </small>
    </div>
  );
}
