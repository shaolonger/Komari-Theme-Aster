import { useState } from "react";
import { Network, Gauge, Globe2, Download, FileJson } from "lucide-react";
import { NetworkBadge } from "./NetworkUi";
import { useQuery } from "@tanstack/react-query";
import {
  nativeReports,
  runNative,
  type NativeRecord,
  type NativeSummary,
} from "@/services/nativeObservatory";
import { NetworkDrawer } from "./NetworkDrawer";
import { formatNetworkTime } from "./shared";
const labels: Record<string, string> = {
  ok: "测量完成",
  application: "网站应用响应",
  partial: "部分完成",
  failed: "检测失败",
  missing: "缺少覆盖",
};
function provenance(r: NativeRecord) {
  return [
    r.source.city,
    r.source.carrier,
    r.source.name,
    (
      { controlled: "自有测量点", runner: "VPS 探测器" } as Record<
        string,
        string
      >
    )[r.source.provider] || r.source.provider,
    r.source.accessType,
    r.source.asn ? `AS${r.source.asn}` : "",
    r.source.network,
  ]
    .filter(Boolean)
    .join(" · ");
}
function headline(r: NativeRecord) {
  const d = r.data;
  if (d.state === "missing" || d.state === "failed") return labels[d.state];
  if (d.kind === "website")
    return `HTTP ${d.httpStatus || 0} · ${d.timingsMs?.ttfb.toFixed(0) || "—"} ms`;
  if (d.kind === "route")
    return `${d.complete ? "到达目标" : "路径不完整"} · ${d.hops?.length || 0} 跳`;
  return (
    (d.runs || [])
      .filter((x) => x.state === "ok")
      .map(
        (x) =>
          `${x.direction === "source-to-target" ? "大陆→VPS" : "VPS→大陆"} ${x.streams} 流 ${(Number(x.bitsPerSecond) / 1e6).toFixed(1)} Mbps`,
      )
      .join(" / ") ||
    labels[d.state] ||
    d.state
  );
}
function asnLabel(asn: string) {
  return asn.replace(/\b(?:AS)?(\d+)\b/g, "AS$1");
}
function hopAttribution(
  h: NonNullable<NativeRecord["data"]["hops"]>[number],
  r: NativeRecord,
) {
  if (!h.address) return "未响应，无法查询归属";
  if (h.asn) return [asnLabel(h.asn), h.network].filter(Boolean).join(" · ");
  const reasons: Record<string, string> = {
    "non-public": "非公网地址，无公网 BGP 归属",
    "lookup-failed": "ASN 查询暂不可用",
    "not-found": "BGP 数据库未返回归属",
    "not-provided": "工具未提供 ASN",
  };
  return (
    reasons[h.asnStatus || ""] ||
    (r.data.method === "Globalping"
      ? "旧公共报告未记录跳点 ASN"
      : "报告未记录 ASN")
  );
}
function exportReport(r: NativeRecord) {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 900;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#f5f6fa";
  ctx.fillRect(0, 0, 1600, 900);
  ctx.fillStyle = "#202636";
  ctx.font = "bold 36px sans-serif";
  ctx.fillText("Aster · 网络观测报告", 60, 70);
  ctx.font = "22px sans-serif";
  const lines = [
    r.direction + " · " + r.target,
    provenance(r),
    formatNetworkTime(r.completedAt),
    headline(r),
    "测量状态：" + (labels[r.data.state] || r.data.state),
    ...(r.data.hops || [])
      .slice(0, 16)
      .map(
        (h) =>
          `${h.ttl}. ${h.address || "*"} ${hopAttribution(h, r)} ${h.rttMs === null ? "" : h.rttMs.toFixed(1) + " ms"}`,
      ),
    ...(r.data.tcpQuality
      ? [
          `TCP 建连 ${r.data.tcpQuality.received}/${r.data.tcpQuality.sent} · 均值 ${r.data.tcpQuality.avgMs?.toFixed(1) ?? "—"} ms · 失败率 ${r.data.tcpQuality.failurePercent ?? "—"}%（非包级丢包）`,
        ]
      : []),
    ...(r.data.runs || []).map(
      (x) =>
        `${x.direction === "source-to-target" ? "大陆→VPS" : "VPS→大陆"} · ${x.streams} 连接 · ${x.state === "ok" ? (Number(x.bitsPerSecond) / 1e6).toFixed(1) + " Mbps" : x.diagnostic || "失败"}`,
    ),
  ];
  lines
    .slice(0, 24)
    .forEach((line, i) => ctx.fillText(line.slice(0, 110), 60, 130 + i * 29));
  ctx.font = "18px sans-serif";
  ctx.fillText(
    "单次端点样本；不推断整个运营商或 VPS 标称带宽。详细诊断请导出 JSON。",
    60,
    855,
  );
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `aster-network-${r.id}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
function jsonReport(r: NativeRecord) {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = `aster-network-${r.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Trend({
  record,
  summaries,
}: {
  record: NativeRecord;
  summaries: NativeSummary[];
}) {
  const rows = summaries
    .filter((s) => s.fingerprint === record.fingerprint)
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-30);
  if (!rows.length)
    return <p className="network-help">尚无可比较的每日汇总。</p>;
  const points = rows.map((s) => ({
      day: s.day,
      value:
        record.data.kind === "speed"
          ? Math.max(
              0,
              ...Object.values(s.speed).map(
                (v) => v.sum / Math.max(1, v.count) / 1e6,
              ),
            )
          : record.data.kind === "website"
            ? s.ttfbTotal / Math.max(1, s.ttfbSamples)
            : (s.ok / Math.max(1, s.samples)) * 100,
      s,
    })),
    speedKeys = [...new Set(rows.flatMap((row) => Object.keys(row.speed)))],
    series =
      record.data.kind === "speed"
        ? speedKeys.map((key) => ({
            label: `${key.startsWith("source-to-target") ? "大陆→VPS" : "VPS→大陆"} · ${key.split(":").at(-1)} 流`,
            color: key.startsWith("source-to-target")
              ? "var(--accent-500)"
              : "var(--status-success)",
            dashed: !key.endsWith(":1"),
            values: rows.map((row) =>
              row.speed[key]
                ? row.speed[key].sum / row.speed[key].count / 1e6
                : null,
            ),
          }))
        : [
            {
              label:
                record.data.kind === "website"
                  ? "平均首字节耗时"
                  : "完成测量比例",
              color: "var(--accent-500)",
              dashed: false,
              values: points.map((p) => p.value),
            },
          ],
    max = Math.max(
      1,
      ...series.flatMap((line) =>
        line.values.filter((v): v is number => v !== null),
      ),
    ),
    x = (i: number) => 50 + (i * 530) / Math.max(1, points.length - 1),
    y = (value: number) => 128 - (value / max) * 105;
  return (
    <div className="native-trend">
      <strong>同端点、来源、协议与参数 · 最近 {rows.length} 天</strong>
      <svg viewBox="0 0 600 150" role="img" aria-label="每日汇总趋势">
        {[0, 0.5, 1].map((ratio) => (
          <g key={ratio}>
            <line
              x1="50"
              x2="580"
              y1={y(max * ratio)}
              y2={y(max * ratio)}
              className="native-chart-grid"
            />
            <text
              x="40"
              y={y(max * ratio) + 4}
              textAnchor="end"
              className="native-chart-label"
            >
              {(max * ratio).toFixed(max < 10 ? 1 : 0)}
            </text>
          </g>
        ))}
        {series.map((line) => (
          <g key={line.label}>
            <path
              fill="none"
              stroke={line.color}
              strokeWidth="2.5"
              strokeDasharray={line.dashed ? "6 4" : undefined}
              d={line.values
                .map((value, i) =>
                  value === null
                    ? ""
                    : `${i === 0 || line.values[i - 1] === null ? "M" : "L"}${x(i)},${y(value)}`,
                )
                .join(" ")}
            />
            {line.values.map((value, i) =>
              value === null ? null : (
                <circle key={i} cx={x(i)} cy={y(value)} r="3" fill={line.color}>
                  <title>
                    {points[i].day} · {line.label} · {value.toFixed(1)}
                  </title>
                </circle>
              ),
            )}
          </g>
        ))}
      </svg>
      <div className="native-chart-legend">
        {series.map((line) => (
          <span key={line.label}>
            <i
              style={{
                background: line.color,
                opacity: line.dashed ? 0.55 : 1,
              }}
            />
            {line.label}
          </span>
        ))}
      </div>
      <small>
        {points[0].day} — {points.at(-1)?.day} ·{" "}
        {record.data.kind === "speed"
          ? "各流量方向与连接配置的日均吞吐（Mbps）"
          : record.data.kind === "website"
            ? "平均首字节耗时（ms）"
            : "完成测量比例（%），非业务可用率"}
      </small>
      <details>
        <summary>每日统计与方向明细</summary>
        <div className="native-table-scroll">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>完成 / 样本</th>
                <th>缺少覆盖</th>
                <th>指标</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.day}>
                  <td>{p.day}</td>
                  <td>
                    {p.s.ok + p.s.application} / {p.s.samples}
                  </td>
                  <td>{p.s.missing}</td>
                  <td>
                    {record.data.kind === "speed"
                      ? Object.entries(p.s.speed).map(([key, v]) => (
                          <div key={key}>
                            {key.startsWith("source-to-target")
                              ? "大陆→VPS"
                              : "VPS→大陆"}{" "}
                            · {key.split(":").at(-1)} 流 ·{" "}
                            {(v.sum / v.count / 1e6).toFixed(1)} Mbps
                          </div>
                        ))
                      : `${p.value.toFixed(1)} ${record.data.kind === "website" ? "ms" : "%"}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
function Hops({ r }: { r: NativeRecord }) {
  const answered = (r.data.hops || []).filter((h) => h.address);
  const attributed = answered.filter((h) => h.asn);
  return (
    <section>
      <h4>
        {r.direction} · {r.data.method || "路径追踪"}
      </h4>
      <p>
        {provenance(r)} ·{" "}
        {r.data.complete ? "目标已响应" : "只展示已观测的跳点，路径不完整"}
      </p>
      <p className="network-help">
        ASN 归属覆盖 {attributed.length} / {answered.length} 个响应跳点。ASN
        是响应 IP 的网络归属资料；位置为数据库标注，不保证路由器物理位置。
      </p>
      <ol className="native-path">
        {(r.data.hops || []).map((h, i) => (
          <li key={i}>
            <span>{h.ttl}</span>
            <div>
              <strong>{h.address || "未响应"}</strong>
              <small>
                {hopAttribution(h, r)} ·{" "}
                {h.rttMs === null ? "—" : `${h.rttMs.toFixed(1)} ms`}
              </small>
              {(h.location || h.prefix) && (
                <small>
                  {[h.location, h.prefix].filter(Boolean).join(" · ")}
                </small>
              )}
              {h.asnSource && (
                <small>
                  归属来源：{h.asnSource}
                  {h.asnQueriedAt
                    ? ` · 查询于 ${formatNetworkTime(h.asnQueriedAt)}`
                    : ""}
                </small>
              )}
            </div>
          </li>
        ))}
      </ol>
      {r.data.quality && (
        <p>
          短时 MTR · {r.data.quality.sent} 次 ·{" "}
          {r.data.quality.terminalConfirmed
            ? "终点"
            : "最后响应跳点（未确认终点）"}{" "}
          {r.data.quality.address} · 丢包 {r.data.quality.lossPercent}% · 平均{" "}
          {r.data.quality.avgMs.toFixed(1)} ms · 标准差{" "}
          {r.data.quality.jitterMs.toFixed(1)} ms
        </p>
      )}
      <small>
        中间跳不响应、限速或单个 ASN 不足以判定业务丢包、GIA 等级或完整 BGP
        AS_PATH。Team Cymru 的国家码是注册信息，不用作跳点位置。
      </small>
    </section>
  );
}
export function NativeWorkspace({
  uuid,
  onConfigure,
}: {
  uuid: string;
  onConfigure: () => void;
}) {
  const query = useQuery({
      queryKey: ["native-reports", uuid],
      queryFn: () => nativeReports(uuid),
      refetchInterval: 15000,
      retry: false,
    }),
    [tab, setTab] = useState<"routes" | "speed" | "websites">("routes"),
    [selected, setSelected] = useState<NativeRecord | null>(null),
    [error, setError] = useState("");
  if (!query.data)
    return (
      <section className="network-section">
        <h3>大陆双向与网站原生观测</h3>
        <p>
          {query.isPending
            ? "正在读取…"
            : "需要网络观测插件 v1.5.0 或以上；旧工具诊断可继续使用。"}
        </p>
        {query.error && (
          <details>
            <summary>读取诊断</summary>
            {query.error.message}
          </details>
        )}
      </section>
    );
  const data = query.data,
    records = data.records.filter((r) =>
      tab === "websites"
        ? r.operation === "website"
        : tab === "speed"
          ? r.operation === "benchmark"
          : ["route", "globalping"].includes(r.operation),
    );
  const latest = records.filter(
      (r, i) => records.findIndex((x) => x.fingerprint === r.fingerprint) === i,
    ),
    policies = data.policies.filter((p) => p.kind === tab);
  const counterpart = selected?.pairId
    ? data.records.find(
        (r) =>
          r.pairId === selected.pairId &&
          r.direction !== selected.direction &&
          Math.abs(
            Date.parse(r.completedAt) - Date.parse(selected.completedAt),
          ) <
            30 * 60000,
      )
    : null;
  const previous = selected
    ? data.records.find(
        (r) =>
          r.fingerprint === selected.fingerprint &&
          r.completedAt < selected.completedAt,
      )
    : null;
  const routeChanged =
    selected?.data.kind === "route" &&
    previous &&
    JSON.stringify(previous.data.hops?.map((h) => h.address)) !==
      JSON.stringify(selected.data.hops?.map((h) => h.address));
  return (
    <section className="native-workspace network-section">
      <div className="native-section-heading">
        <div>
          <h3>原生网络观测</h3>
          <small>实际来源与方向 · 详细报告 7 天 / 每日汇总 90 天</small>
        </div>
        <button className="network-primary-button" onClick={onConfigure}>
          设置检测方案
        </button>
      </div>
      <div
        className="native-tabs"
        role="tablist"
        aria-label="网络观测类别"
        onKeyDown={(e) => {
          const order = ["routes", "speed", "websites"] as const;
          const index = order.indexOf(tab);
          const move =
            e.key === "ArrowRight"
              ? (index + 1) % 3
              : e.key === "ArrowLeft"
                ? (index + 2) % 3
                : e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? 2
                    : -1;
          if (move >= 0) {
            e.preventDefault();
            setTab(order[move]);
            (
              e.currentTarget.querySelectorAll("button")[
                move
              ] as HTMLButtonElement
            ).focus();
          }
        }}
      >
        {(
          [
            { id: "routes", name: "大陆线路" },
            { id: "speed", name: "大陆测速" },
            { id: "websites", name: "国际网站" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.id === "routes" ? (
              <Network size={16} aria-hidden="true" />
            ) : t.id === "speed" ? (
              <Gauge size={16} aria-hidden="true" />
            ) : (
              <Globe2 size={16} aria-hidden="true" />
            )}
            {t.name}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        aria-label={
          { routes: "大陆线路", speed: "大陆测速", websites: "国际网站" }[tab]
        }
      >
        <p className="network-help">
          {tab === "routes"
            ? "大陆→VPS 与 VPS→大陆分别实测。公共去程/回程目标为独立样本；自有同端点测量才按双向对照展示。"
            : tab === "speed"
              ? "大陆端主动连接 VPS，单连接和多连接、两个流量方向分别全速测试。结果代表两端当时条件。"
              : "网站 / API 与 CDN 分组检测。保留实际 DNS/CDN IP、TCP 建连样本与 HTTPS 阶段耗时；401/403 等应用响应单独显示。"}
        </p>
        <div className="native-coverage-grid">
          {latest.map((r) => {
            const p = data.policies.find((p) => p.id === r.policyId),
              age = Date.now() - Date.parse(r.completedAt),
              stale =
                age >
                (p?.timing.type === "interval"
                  ? p.timing.minutes * 60000 * 2
                  : 48 * 3600000);
            return (
              <button
                key={r.fingerprint}
                className="native-result-card"
                data-state={r.data.state}
                onClick={() => setSelected(r)}
              >
                <div className="native-result-top">
                  <span>
                    {r.data.kind === "website"
                      ? String(r.options.websiteName || r.target)
                      : r.source.carrier || r.direction}
                  </span>
                  <NetworkBadge state={r.data.state}>
                    {labels[r.data.state] || r.data.state}
                  </NetworkBadge>
                </div>
                {r.data.kind === "speed" && r.data.runs?.length ? (
                  <div className="native-speed-mini">
                    {r.data.runs.map((run, i) => (
                      <div key={i}>
                        <span>
                          {run.direction === "source-to-target"
                            ? "大陆→VPS"
                            : "VPS→大陆"}{" "}
                          · {run.streams} 流
                        </span>
                        <strong>
                          {run.state === "ok"
                            ? `${(Number(run.bitsPerSecond) / 1e6).toFixed(1)} Mbps`
                            : "失败"}
                        </strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <strong>{headline(r)}</strong>
                )}
                {r.data.kind === "website" && (
                  <>
                    <small>
                      {r.target} · {String(r.options.websiteGroup || "网站")}
                    </small>
                    {r.data.tcpQuality && (
                      <small>
                        TCP 均值 {r.data.tcpQuality.avgMs?.toFixed(1) ?? "—"} ms
                        · 建连失败率 {r.data.tcpQuality.failurePercent ?? "—"}%
                      </small>
                    )}
                    {r.data.tcpQuality?.addressScope === "non-public" && (
                      <small>连接目标为非公网 IP · 请检查 DNS / 代理</small>
                    )}
                  </>
                )}
                {r.data.kind !== "website" && (
                  <small>
                    {r.direction} · {r.target || "缺少目标"}
                  </small>
                )}
                <small>{provenance(r)}</small>
                <time>
                  {formatNetworkTime(r.completedAt)}
                  {stale ? " · 数据过期" : ""}
                </time>
              </button>
            );
          })}
        </div>
        {!latest.length && (
          <div className="network-empty-state">
            <strong>
              尚无
              {
                { routes: "大陆线路", speed: "大陆测速", websites: "国际网站" }[
                  tab
                ]
              }
              样本
            </strong>
            <p>
              先设置方案，预览实际覆盖，再执行检测。未接入的测量点不会显示成 0
              Mbps 或网络质量差。
            </p>
            <button onClick={onConfigure}>设置方案</button>
          </div>
        )}
        {!!data.jobs.length && (
          <div className="network-task-list" role="status">
            {data.jobs.map((j) => (
              <p key={j.id}>
                {j.direction} · {j.target || "缺少目标"} ·{" "}
                {(
                  {
                    queued: "排队",
                    listening: "建立临时测速监听",
                    ready: "等待大陆端",
                    running: "测量中",
                    submitting: "提交公共测量",
                    provider: "等待公共结果",
                  } as Record<string, string>
                )[j.phase] || j.phase}
              </p>
            ))}
          </div>
        )}
        {!!policies.length && (
          <details>
            <summary>本类计划 · {policies.length}</summary>
            {policies.map((p) => (
              <p key={p.id}>
                {p.name} · {p.enabled ? "启用" : "暂停"} · 下次{" "}
                {formatNetworkTime(new Date(p.nextAt).toISOString())}{" "}
                <button
                  disabled={!p.enabled}
                  onClick={() =>
                    void runNative(p.id)
                      .then(() => query.refetch())
                      .catch((e) => setError(String(e.message)))
                  }
                >
                  立即检测
                </button>
              </p>
            ))}
          </details>
        )}
        <details>
          <summary>近期测量 · {records.length}</summary>
          {records.map((r) => (
            <button
              className="native-history-row"
              key={r.id}
              onClick={() => setSelected(r)}
            >
              <time>{formatNetworkTime(r.completedAt)}</time>
              <span>
                {r.direction} · {r.target}
              </span>
              <strong title={headline(r)}>
                {r.data.kind === "speed"
                  ? "单 / 多连接 · 查看测速"
                  : headline(r)}
              </strong>
            </button>
          ))}
        </details>
      </div>
      {error && <p role="alert">{error}</p>}
      {selected && (
        <NetworkDrawer title="原生网络报告" onClose={() => setSelected(null)}>
          <div className="network-form">
            <div className="native-report-heading">
              <div className="native-report-meta">
                <NetworkBadge state={selected.data.state}>
                  {labels[selected.data.state] || selected.data.state}
                </NetworkBadge>
                <NetworkBadge>
                  IPv{String(selected.options.family || "auto")}
                </NetworkBadge>
                <NetworkBadge>{selected.direction}</NetworkBadge>
              </div>
              <strong>
                {selected.data.kind === "speed"
                  ? "大陆双向吞吐测量"
                  : headline(selected)}
              </strong>
              <p>
                {selected.direction} · {selected.target}
              </p>
              <small>
                {provenance(selected)} ·{" "}
                {formatNetworkTime(selected.completedAt)}
              </small>
              <p>
                {labels[selected.data.state] || selected.data.state} · IPv
                {String(selected.options.family || "auto")} ·{" "}
                {selected.source.provider === "controlled"
                  ? "测量点位置由管理员声明"
                  : "来源由工具/提供方返回"}
              </p>
              <div className="network-actions">
                <button onClick={() => exportReport(selected)}>
                  <Download size={14} aria-hidden="true" />
                  导出 PNG
                </button>
                <button onClick={() => jsonReport(selected)}>
                  <FileJson size={14} aria-hidden="true" />
                  导出完整 JSON
                </button>
              </div>
            </div>
            {selected.data.kind === "website" && (
              <>
                {selected.data.tcpQuality ? (
                  <section className="network-section">
                    <h4>
                      TCP 连接质量 · {selected.data.tcpQuality.received} /{" "}
                      {selected.data.tcpQuality.sent} 次成功
                    </h4>
                    <div className="native-metrics">
                      <article>
                        <small>建连均值</small>
                        <strong>
                          {selected.data.tcpQuality.avgMs?.toFixed(1) ?? "—"} ms
                        </strong>
                      </article>
                      <article>
                        <small>最小 / 最大</small>
                        <strong>
                          {selected.data.tcpQuality.minMs?.toFixed(1) ?? "—"} /{" "}
                          {selected.data.tcpQuality.maxMs?.toFixed(1) ?? "—"} ms
                        </strong>
                      </article>
                      <article>
                        <small>建连失败率</small>
                        <strong>
                          {selected.data.tcpQuality.failurePercent ?? "—"}%
                        </strong>
                      </article>
                      <article>
                        <small>建连耗时标准差</small>
                        <strong>
                          {selected.data.tcpQuality.stdevMs?.toFixed(1) ?? "—"}{" "}
                          ms
                        </strong>
                      </article>
                    </div>
                    <p className="network-help">
                      {selected.data.tcpQuality.method} ·{" "}
                      {selected.data.tcpQuality.address || "无可用连接 IP"}
                      。完整握手样本；失败包括超时或拒绝连接，不作为包级丢包率。仅代表该
                      IP 的短时样本。
                    </p>
                    {selected.data.tcpQuality.addressScope === "non-public" && (
                      <p role="status">
                        目标 IP 为私网或保留地址，可能由本地 DNS /
                        代理映射。建连耗时可能仅到代理入口，不能作为国际公网线路样本。
                      </p>
                    )}
                  </section>
                ) : (
                  <p className="network-help">
                    此报告未包含 TCP 重复采样；升级 VPS 探测器到 v1.6.0
                    后重新检测即可获得。
                  </p>
                )}
                <h4>HTTPS 访问阶段</h4>
                <div className="native-metrics">
                  {Object.entries(selected.data.timingsMs || {}).map(
                    ([key, value]) => (
                      <article key={key}>
                        <small>
                          {
                            (
                              {
                                dns: "DNS",
                                connect: "TCP 建连",
                                tls: "TLS 握手",
                                ttfb: "首字节（累计）",
                                total: "总耗时",
                              } as Record<string, string>
                            )[key]
                          }
                        </small>
                        <strong>{value.toFixed(1)} ms</strong>
                      </article>
                    ),
                  )}
                </div>
                <p>
                  HTTP {selected.data.httpStatus || "未收到响应"} · 连接 IP{" "}
                  {selected.data.resolvedIp || "未知"} · TLS{" "}
                  {selected.data.tlsVerified ? "验证成功" : "未完成验证"}
                </p>
                <small>
                  资源路径：{selected.data.path || "/"} · 使用 VPS DNS
                  选择的连接 IP；网站 / CDN 成功不能推断跨洲骨干质量。
                </small>
                {selected.data.errorStage && (
                  <p>失败阶段：{selected.data.errorStage}</p>
                )}
                {selected.data.state === "application" && (
                  <p>
                    已经收到应用响应；访问拒绝或认证要求单独标注，不判作网络不可达。
                  </p>
                )}
              </>
            )}
            {selected.data.kind === "route" && (
              <>
                <p>
                  {routeChanged
                    ? "与上一份同条件报告相比，响应跳点发生变化。"
                    : "路径只记录已响应跳点；不会补画未知线路。"}
                </p>
                <div className="native-paired-paths">
                  <Hops r={selected} />
                  {counterpart ? (
                    <Hops r={counterpart} />
                  ) : (
                    <section>
                      <h4>另一个方向</h4>
                      <p>
                        {selected.pairId
                          ? "尚无同一端点对的近期反向样本；探针 NAT 或离线时覆盖可能不完整。"
                          : "公共样本没有可配对的端点，不能推断另一方向。"}
                      </p>
                    </section>
                  )}
                </div>
              </>
            )}
            {selected.data.kind === "speed" && (
              <>
                <div className="native-metrics">
                  {selected.data.runs?.map((r, i) => (
                    <article key={i}>
                      <small>
                        {r.direction === "source-to-target"
                          ? "大陆→VPS"
                          : "VPS→大陆"}{" "}
                        · {r.streams} 连接
                      </small>
                      <strong>
                        {r.state === "ok"
                          ? `${(Number(r.bitsPerSecond) / 1e6).toFixed(1)} Mbps`
                          : "失败"}
                      </strong>
                      <small>
                        {r.bytes === null
                          ? "—"
                          : `${(Number(r.bytes) / 1e6).toFixed(1)} MB`}{" "}
                        · {r.seconds?.toFixed(1) || "—"} 秒 · 重传{" "}
                        {r.retransmits ?? "未提供"}
                      </small>
                      <small>
                        {r.remoteIp} {r.diagnostic}
                      </small>
                    </article>
                  ))}
                </div>
                <p>
                  TCP
                  不限速，接收端实测速率；无预热排除。上下行串行执行，不等同于
                  VPS 标称带宽。
                </p>
              </>
            )}
            <Trend record={selected} summaries={data.summaries} />
            <details className="network-disclosure native-report-diagnostics">
              <summary>完整诊断与测量参数</summary>
              <pre className="network-raw-output">
                {selected.data.diagnostic || "无额外诊断"}
                {"\n"}
                {JSON.stringify(selected.options, null, 2)}
              </pre>
            </details>
          </div>
        </NetworkDrawer>
      )}
    </section>
  );
}
