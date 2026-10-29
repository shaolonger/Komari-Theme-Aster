import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Download,
  Globe2,
  Network,
  Settings2,
} from "lucide-react";
import {
  shareReportRound,
  revokeReportShares,
  cancelReportRound,
  deleteFullReportRound,
  getReportRound,
  listReportRounds,
  reportCatalog,
  runReportSuite,
  type ReportModule,
  type ReportRound,
  type ReportMeasurement,
  type ReportSlot,
} from "@/services/reportObservatory";
import { NetworkDrawer } from "./NetworkDrawer";
import { NetworkBadge, NetworkSectionHeading } from "./NetworkUi";
import {
  foldHops,
  numberText,
  reportLabels,
  routeEvidence,
  sampleBand,
} from "./reportMetrics";
import { formatNetworkTime } from "./shared";
import { exportReportPng } from "./reportExport";
import { SpeedReport } from "./SpeedReport";
import { BgpReport } from "./BgpReport";
import { ReportHistory } from "./ReportHistory";
import { RouteHopIdentity, RoutePathSummary, RouteMetadataObservation } from "./RouteMetadata";
import "@/styles/network-reports.css";

const moduleTitles: Record<ReportModule, string> = {
  routes: "大陆路由",
  "tcp-quality": "大陆 TCP 质量",
  "tcpquality-full": "TcpQuality 完整检测",
  "nodequality-full": "NodeQuality 完整检测",
  "china-speed": "大陆单连接测速",
  international: "国际延迟",
  idc: "常见 IDC 延迟",
  "international-speed": "国际单连接测速",
  bgp: "全球 BGP 路径快照",
};
function FullTcpQualityReport({ round }: { round: ReportRound }) {
  const result = round.measurements[0];
  if (!result) return <p className="report-caption">{round.state === "running" ? "检测正在进行，完整测试可能持续数小时。" : round.slots[0]?.missingReason || "本轮尚无报告。"}</p>;
  const data = result.data;
  let reportUrl = "";
  try { const url = new URL(data.reportUrl || ""); if (url.origin === "https://tcpquality.ibsgss.uk" && /^\/r\/[A-Za-z0-9_-]+$/.test(url.pathname) && !url.search && !url.hash && !url.username && !url.password) reportUrl = url.href; } catch { /* Invalid or absent URL. */ }
  function downloadCsv() {
    const url = URL.createObjectURL(new Blob([data.csv || ""], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `TcpQuality-${round.id}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  return <div className="report-full-tcp">
    <p><NetworkBadge state={data.state}>{reportLabels[data.state] || data.state}</NetworkBadge> · 档位 {data.profile || "自动"} · {formatNetworkTime(result.completedAt)}</p>
    {data.diagnostic && <p role="status">{reportUrl && data.diagnostic === "在线报告上传失败；已保留 CSV" ? "上游报告已补传；检测完成时的原始状态保留在 JSON 中。" : data.diagnostic}</p>}
    {data.coverage && <div className="report-full-coverage">
      <p>测量覆盖：{data.coverage.state === "complete" ? "已确认" : data.coverage.state === "partial" ? "部分覆盖" : "无法确认"} · 成功 {data.coverage.ok} · 失败 {data.coverage.failed} · 跳过 {data.coverage.skipped} · 未知 {data.coverage.unknown}</p>
      <p>IPv4：{{available: "可用", unavailable: "不可用", unknown: "未知"}[data.coverage.ipv4]} · IPv6：{{available: "可用", unavailable: "不可用", unknown: "未知"}[data.coverage.ipv6]}</p>
      {data.coverage.sections.length > 0 && <details><summary>各检测项目覆盖</summary>{data.coverage.sections.map(section => <p key={section.name}>{section.name}：成功 {section.ok} / 失败 {section.failed} / 跳过 {section.skipped} / 未知 {section.unknown}</p>)}</details>}
    </div>}
    {reportUrl && <section className="report-upstream-preview" aria-label="TcpQuality 在线报告预览">
      <div className="report-upstream-heading">
        <div><strong>在线报告预览</strong><p>在此查看上游报告及其分类切换。</p></div>
        <a href={reportUrl} target="_blank" rel="noreferrer">无法预览？打开原报告</a>
      </div>
      <iframe
        key={round.id + reportUrl}
        title="TcpQuality 在线报告"
        src={reportUrl}
        loading="lazy"
        sandbox="allow-scripts allow-same-origin allow-downloads allow-popups"
        allow="clipboard-write"
        referrerPolicy="no-referrer"
      />
      <p className="report-caption">报告由上游网站提供，小屏幕可在预览区域横向滑动；若显示空白或被拦截，请使用上方链接。原始记录仍可在下方查看。</p>
    </section>}
    <div className="report-actions">
      {data.csv && <button type="button" onClick={downloadCsv}>下载 CSV{data.csvTruncated ? "（已截断）" : ""}</button>}
    </div>
    {(data.logTruncated || data.csvTruncated) && <p role="status">报告超过保存上限，展示或下载的内容已截断；请查看探测器上的原始文件。</p>}
    {data.cleanLog && <details open><summary>检测报告</summary><pre className="report-json">{data.cleanLog}</pre></details>}
  </div>;
}
function FullNodeQualityReport({ round }: { round: ReportRound }) {
  const result = round.measurements[0];
  if (!result) return <p className="report-caption">{round.state === "running" ? "检测正在进行，完整测试可能持续数小时。" : round.slots[0]?.missingReason || "本轮尚无报告。"}</p>;
  const data = result.data;
  let reportUrl = "";
  try { const url = new URL(data.reportUrl || ""); if ((url.origin === "https://nodequality.com" || url.origin === "https://www.nodequality.com") && /^\/r\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname) && !url.search && !url.hash && !url.username && !url.password) reportUrl = url.href; } catch { /* Invalid or absent URL. */ }
  const names: Record<string, string> = {hardware_quality: "硬件性能", ip_quality: "IP 质量", net_quality: "网络质量", backroute_trace: "回程路由", header_info: "服务器信息", port: "端口信息"};
  return <div className="report-full-tcp">
    <p><NetworkBadge state={data.state}>{reportLabels[data.state] || data.state}</NetworkBadge> · {formatNetworkTime(result.completedAt)} · {data.family === "auto" ? "IPv4 / IPv6" : `IPv${data.family || "?"}`}</p>
    {data.diagnostic && <p role="status">{data.diagnostic}</p>}
    <p className="report-caption">完成状态表示所选项目的报告文件已取得；具体子项是否成功请查看报告。</p>
    {reportUrl && <section className="report-upstream-preview" aria-label="NodeQuality 在线报告预览"><div className="report-upstream-heading"><div><strong>在线报告预览</strong><p>上游报告可能包含服务器及网络信息。</p></div><a href={reportUrl} target="_blank" rel="noreferrer">无法预览？打开原报告</a></div><iframe key={round.id + reportUrl} title="NodeQuality 在线报告" src={reportUrl} loading="lazy" sandbox="allow-scripts allow-same-origin allow-downloads allow-popups" referrerPolicy="no-referrer" /><p className="report-caption">如果上游限制嵌入，请使用链接查看；原始输出仍保存在下方。</p></section>}
    {data.sectionsTruncated && <p role="status">部分原始数据超过保存上限，完整文件保留在探测器上。</p>}
    {Object.entries(data.sections || {}).map(([name, text]) => <details key={name}><summary>{names[name.replace(/\.(json|log)$/, "")] || name} · {name.endsWith(".json") ? "JSON" : "日志"}</summary><pre className="report-json">{text}</pre></details>)}
    {data.cleanLog && <details><summary>执行日志</summary><pre className="report-json">{data.cleanLog}</pre></details>}
  </div>;
}
const sourceText = (slot: ReportSlot) =>
  [
    slot.source.provider,
    slot.source.city,
    slot.source.carrier,
    slot.source.name,
    slot.source.accessType,
  ]
    .filter(Boolean)
    .join(" · ");
function exportRound(round: ReportRound) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(round, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `Aster-${round.module}-${round.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
function LatencyMatrix({
  round,
  onInspect,
}: {
  round: ReportRound;
  onInspect: (slot: ReportSlot, result?: ReportMeasurement) => void;
}) {
  const [group, setGroup] = useState("aws"),
    [provider, setProvider] = useState("");
  const idc = round.module === "idc";
  const availableGroups = [
    ...new Set(round.slots.map((s) => s.endpoint?.category || "coverage")),
  ];
  const providers = [
    ...new Set(round.slots.map((s) => s.endpoint?.provider || "未知")),
  ];
  const actualGroup = availableGroups.includes(group)
    ? group
    : availableGroups[0];
  const actualProvider = providers.includes(provider) ? provider : providers[0];
  const names: Record<string, string> = {
    "china-route": "大陆三网",
    aws: "AWS",
    websites: "网站",
    cdn: "CDN",
    telegram: "Telegram",
    idc: "IDC / 自定义目标",
    coverage: "覆盖情况",
  };
  const visible = round.slots.filter((s) =>
    idc
      ? (s.endpoint?.provider || "未知") === actualProvider
      : (s.endpoint?.category || "coverage") === actualGroup,
  );
  return (
    <>
      <div
        className="report-pills"
        aria-label={idc ? "IDC 商家" : "国际目标分类"}
      >
        {(idc ? providers : availableGroups).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={key === (idc ? actualProvider : actualGroup)}
            onClick={() => (idc ? setProvider(key) : setGroup(key))}
          >
            {idc ? key : names[key] || key}
          </button>
        ))}
      </div>
      <p className="report-caption">
        TCP 建连延迟 · 主数值为成功样本中位数 ·
        每块对应本轮一次握手，失败不计入延迟
      </p>
      <div className="report-latency-grid" data-module={round.module}>
        {visible.map((slot) => {
          const result = round.measurements.find((r) => r.slotId === slot.id),
            q = result?.data.tcpQuality;
          return (
            <article
              className="report-latency-card"
              key={slot.id}
              data-state={slot.state}
            >
              <div>
                <button
                  className="report-target-name"
                  onClick={() => onInspect(slot, result)}
                  title={slot.target}
                >
                  {slot.endpoint?.name || slot.target || "尚未配置目标"}
                </button>
                <strong>
                  {numberText(q?.medianMs)}
                  <small> ms</small>
                </strong>
              </div>
              <div
                className="report-samples"
                aria-label={`本轮 ${round.parameters.samples || 10} 次 TCP 建连样本`}
              >
                {Array.from({ length: round.parameters.samples || 10 }, (_, i) => {
                  const sample = q?.samples.find((s) => s.index === i + 1);
                  const label = `第 ${i + 1} 次：${sample ? (sample.state === "ok" ? numberText(sample.rttMs) + " ms" : (sample.state === "timeout" ? "超时" : sample.state === "refused" ? "连接被拒绝" : "建连失败") + " · " + sample.error) : "尚未采样"}`;
                  return (
                    <button
                      key={i}
                      className={`report-sample report-sample-${sampleBand(sample)}`}
                      aria-label={label}
                      title={label}
                      onClick={() => onInspect(slot, result)}
                    />
                  );
                })}
              </div>
              <div className="report-card-footer">
                <span>
                  {q?.sent
                    ? `建连失败 ${q.sent - q.received}/${q.sent}`
                    : reportLabels[slot.state] || "未采样"}
                </span>
                <span>
                  {slot.endpoint?.country || slot.endpoint?.regionCode || ""}
                </span>
              </div>
              {round.module === "tcp-quality" && <div className="report-tcp-comparisons">
                {(result?.data.synProbes || []).map(probe => <p key={probe.payloadBytes}>
                  SYN +{probe.payloadBytes} B：{probe.state === "unavailable" ? probe.diagnostic : `${probe.received}/${probe.sent} 响应 · 未响应 ${numberText(probe.unansweredPercent)}% · RTT ${numberText(probe.avgMs)} ms`}
                </p>)}
              </div>}
              {slot.state === "missing" && (
                <p>{result?.data.diagnostic || slot.missingReason}</p>
              )}
            </article>
          );
        })}
      </div>
      <div className="report-color-legend" aria-label="延迟颜色说明">
        {[
          ["fast", "<30"],
          ["good", "30–80"],
          ["fair", "80–150"],
          ["slow", "150–250"],
          ["distant", "≥250 ms"],
          ["failure", "失败"],
          ["unmeasured", "未采样"],
        ].map(([band, label]) => (
          <span key={band}>
            <i className={`report-sample-${band}`} />
            {label}
          </span>
        ))}
      </div>
    </>
  );
}
function MtrReport({
  round,
  onInspect,
}: {
  round: ReportRound;
  onInspect: (slot: ReportSlot, result?: ReportMeasurement) => void;
}) {
  const [direction, setDirection] = useState("VPS→大陆"),
    [selection, setSelection] = useState(""),
    [fold, setFold] = useState(false);
  const [city, setCity] = useState(""),
    [carrier, setCarrier] = useState(""),
    [protocol, setProtocol] = useState("tcp");
  const directional = round.slots.filter((s) => s.direction === direction),
    cities = [
      ...new Set(
        directional.map(
          (s) => s.source.city || s.endpoint?.city || "公共/未声明",
        ),
      ),
    ];
  const actualCity = cities.includes(city) ? city : cities[0],
    regional = directional.filter(
      (s) =>
        (s.source.city || s.endpoint?.city || "公共/未声明") === actualCity,
    );
  const carriers = [
      ...new Set(regional.map((s) => s.source.carrier || "未声明")),
    ],
    actualCarrier = carriers.includes(carrier) ? carrier : carriers[0];
  const choices = regional.filter(
      (s) => (s.source.carrier || "未声明") === actualCarrier,
    ),
    protocols = [
      ...new Set(choices.map((s) => String(s.options.protocol || "tcp"))),
    ],
    actualProtocol = protocols.includes(protocol) ? protocol : protocols[0];
  const slots = choices.filter(
    (s) => (s.options.protocol || "tcp") === actualProtocol,
  );
  const selected = slots.find((s) => s.id === selection) || slots[0];
  const result = round.measurements.find((r) => r.slotId === selected?.id);
  const hops = result?.data.hops || [];
  const evidence = routeEvidence(hops);
  const groups = foldHops(hops, fold);
  const paired = result?.pairId
    ? round.measurements.find(
        (r) => r.pairId === result.pairId && r.direction !== result.direction,
      )
    : undefined;
  return (
    <>
      <div className="report-pills" aria-label="路由地区">
        {cities.map((c) => (
          <button
            key={c}
            aria-pressed={actualCity === c}
            onClick={() => setCity(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="report-filter-row">
        <div className="report-pills" aria-label="运营商">
          {carriers.map((c) => (
            <button
              key={c}
              aria-pressed={actualCarrier === c}
              onClick={() => setCarrier(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="report-pills" aria-label="探测协议">
          {protocols.map((p) => (
            <button
              key={p}
              aria-pressed={actualProtocol === p}
              onClick={() => setProtocol(p)}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="report-filter-row">
        <div className="report-pills">
          {["VPS→大陆", "大陆→VPS"].map((d) => (
            <button
              key={d}
              aria-pressed={direction === d}
              onClick={() => {
                setDirection(d);
                setSelection("");
              }}
            >
              {d === "VPS→大陆" ? "回程 · VPS→大陆" : "去程 · 大陆→VPS"}
            </button>
          ))}
        </div>
        <button
          className="report-fold"
          aria-pressed={fold}
          onClick={() => setFold(!fold)}
        >
          {fold ? "逐跳展开" : "按 AS 折叠"}
        </button>
      </div>
      <label className="report-target-select">
        测量目标与来源
        <select
          value={selected?.id || ""}
          onChange={(e) => setSelection(e.target.value)}
        >
          {slots.map((s) => (
            <option key={s.id} value={s.id}>
              {s.endpoint?.name || sourceText(s)} ·{" "}
              {String(s.options.protocol || "tcp").toUpperCase()} ·{" "}
              {s.target || "缺少公网目标"}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <p className="report-caption">
          {result?.data.method || "尚未测量"} ·{" "}
          {String(selected.options.protocol || "tcp").toUpperCase()} · 端口{" "}
          {String(selected.options.port || 443)} · {sourceText(selected)} ·{" "}
          {result?.completedAt
            ? formatNetworkTime(result.completedAt)
            : reportLabels[selected.state]}
        </p>
      )}
      {!!evidence.length && (
        <div className="report-evidence">
          {evidence.map((e) => (
            <span
              key={e.id}
              title={`${e.basis}；证据跳号 ${e.ttls.join(", ")}；来源 ${e.source}；规则 ${e.ruleVersion}`}
            >
              {e.label}
            </span>
          ))}
        </div>
      )}
      {result && <p className="report-caption">终点{result.data.complete ? "已确认到达" : "未确认到达（末跳未响应不代表业务 100% 丢包）"} · 商业产品未核验</p>}
      <RoutePathSummary hops={hops} />
      {!!hops.length && (
        <div className="report-table-scroll">
          <table className="report-mtr-table">
            <thead>
              <tr>
                {[
                  "跳",
                  "ASN / 网络与位置",
                  "IP",
                  "未响应",
                  "发送 / 响应",
                  "Last",
                  "Avg",
                  "Best",
                  "Worst",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const hop = group[0],
                  multi = group.length > 1;
                return (
                  <tr key={hop.ttl}>
                    <td>
                      {multi
                        ? `${hop.ttl}–${group[group.length - 1].ttl}`
                        : hop.ttl}
                    </td>
                    <td>
                      <RouteHopIdentity hop={hop} />
                      {multi && (
                        <button onClick={() => setFold(false)}>
                          展开 {group.length} 跳
                        </button>
                      )}
                    </td>
                    <td>
                      {multi ? `${group.length} 个跳点` : hop.address || "*"}
                    </td>
                    <td>
                      {multi
                        ? "展开查看"
                        : hop.lossPercent == null
                          ? "—"
                          : numberText(hop.lossPercent) + "%"}
                    </td>
                    <td>
                      {multi
                        ? "—"
                        : hop.sent === undefined
                          ? "—"
                          : `${hop.sent} / ${hop.receivedEstimated ? "≈" : ""}${hop.received ?? "—"}`}
                    </td>
                    {["lastMs", "avgMs", "bestMs", "worstMs"].map((field) => (
                      <td key={field}>
                        {multi
                          ? "—"
                          : numberText(hop[field] as number | null | undefined)}
                        <small> ms</small>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!hops.length && (
        <div className="report-empty">
          {result?.data.diagnostic ||
            selected?.missingReason ||
            "此方向尚无已采集路径"}
        </div>
      )}
      <p className="report-caption">
        中间跳点未响应可能来自回包限速，不能据此认定业务丢包。折叠段不合并丢包或延迟；线路标签只说明观察到的
        网络证据，不认证 GIA 等商业产品；中间跳 RTT 包含回包路径，不能作为单向耗时。
      </p>
      {result?.data.routeChange && (
        <details>
          <summary>
            相邻观测比较 ·{" "}
            {result.data.routeChange.comparable
              ? result.data.routeChange.observedAsPathChanged
                ? "观察到的 AS 序列不同"
                : "观察到的 AS 序列一致"
              : "尚无可比来源，建立基线"}
          </summary>
          <p>{result.data.routeChange.conditions}</p>
          {result.data.routeChange.comparable && (
            <p>
              {result.data.routeChange.previousAsPath.join(" → ")}
              <br />
              {result.data.routeChange.currentAsPath.join(" → ")}
            </p>
          )}
        </details>
      )}
      {result && <RouteMetadataObservation data={result.data} />}
      {paired && (
        <p className="report-caption">
          同一轮、同一测量点的反向报告已保存：{paired.direction} ·{" "}
          {formatNetworkTime(paired.completedAt)}
        </p>
      )}
      {selected && (
        <button
          className="report-text-action"
          onClick={() => onInspect(selected, result)}
        >
          查看原始输出、归属来源与测量条件
        </button>
      )}
    </>
  );
}
function RoundModule({
  uuid,
  module,
  onConfigure,
}: {
  uuid: string;
  module: ReportModule;
  onConfigure: () => void;
}) {
  const [selection, setSelection] = useState<string | null>(() => module === "routes" ? new URLSearchParams(window.location.search).get("round") : null),
    [error, setError] = useState(""),
    [inspected, setInspected] = useState<{
      slot: ReportSlot;
      result?: ReportMeasurement;
    } | null>(null);
  const history = useInfiniteQuery({
    queryKey: ["report-rounds", uuid, module],
    queryFn: ({ pageParam }) => listReportRounds(uuid, module, pageParam),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor || undefined,
    refetchInterval: 15000,
  });
  const rounds = [
    ...new Map(
      history.data?.pages.flatMap((p) => p.rounds).map((r) => [r.id, r]) || [],
    ).values(),
  ];
  const picked =
    rounds.find((r) => r.id === selection) ||
    (["tcpquality-full", "nodequality-full"].includes(module) ? rounds[0] : undefined) ||
    rounds.find((r) => r.state === "complete" && r.detailAvailable) ||
    rounds[0];
  const pickedId = selection || picked?.id;
  const detail = useQuery({
    queryKey: ["report-round", uuid, pickedId],
    queryFn: () => getReportRound(uuid, pickedId!),
    enabled: !!pickedId,
    refetchInterval: picked?.state === "running" ? 5000 : false,
  });
  const catalog = useQuery({
    queryKey: ["report-catalog"],
    queryFn: reportCatalog,
    staleTime: 15000,
  });
  const policies =
    catalog.data?.suites.filter(
      (s) =>
        s.enabled &&
        (s.clients.includes(uuid) ||
          s.groups.some((g) =>
            catalog.data?.inventory.some(
              (n) => n.uuid === uuid && n.group === g,
            ),
          )) &&
        s.modules.some((m) => m.module === module && m.enabled),
    ) || [];
  const [share, setShare] = useState<string>(""),
    [shareRound, setShareRound] = useState<string>("");
  const selectedIndex = rounds.findIndex((r) => r.id === picked?.id),
    round = detail.data;
  async function run() {
    setError("");
    try {
      for (const policy of policies) await runReportSuite(policy.id, module, [uuid]);
      const next = await history.refetch();
      setSelection(next.data?.pages[0].rounds[0]?.id || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <section className="report-module">
      <NetworkSectionHeading
        icon={module === "routes" ? Network : Globe2}
        title={moduleTitles[module]}
        description={
          round
            ? `计划 ${formatNetworkTime(round.plannedAt)} · ${reportLabels[round.state]} · ${round.counts.completed}/${round.counts.expected} 个目标收尾`
            : "每次检测按独立轮次保存"
        }
        aside={
          <div className="report-actions">
            <button onClick={policies.length ? () => void run() : onConfigure}>
              {policies.length ? "立即检测" : "设置计划"}
            </button>
            {round && (
              <details
                className="report-more-actions"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.open = false;
                    e.currentTarget.querySelector("summary")?.focus();
                  }
                }}
              >
                <summary aria-label="更多报告操作">⋯</summary>
                <div
                  onClick={(e) =>
                    e.currentTarget.closest("details")?.removeAttribute("open")
                  }
                >
                  <button
                    aria-label="导出本轮 JSON"
                    onClick={() => exportRound(round)}
                  >
                    <Download size={15} />
                    完整 JSON
                  </button>
                  {!["tcpquality-full", "nodequality-full"].includes(module) && <button onClick={() => exportReportPng(round)}>
                    汇总 PNG
                  </button>}
                  {["tcpquality-full", "nodequality-full"].includes(module) && round.state !== "running" && <button onClick={() => {
                    if (!window.confirm("删除本轮完整检测报告？此操作不可撤销。")) return;
                    void deleteFullReportRound(uuid, round.id).then(() => { setSelection(null); return history.refetch(); }).catch(e => setError(String(e.message)));
                  }}>删除本轮报告</button>}
                  {round?.detailAvailable && round.state !== "running" && (
                    <button
                      title="创建七天以内的公开链接，包含完整原始数据，可能涉及服务器信息与报告链接"
                      onClick={() => {
                        void shareReportRound(uuid, round.id)
                          .then(async (data) => {
                            const url = new URL(data.url, location.origin).href;
                            setShare(url);
                            setShareRound(round.id);
                            try {
                              await navigator.clipboard.writeText(url);
                            } catch {
                              /* Link remains selectable. */
                            }
                          })
                          .catch((e) => setError(String(e)));
                      }}
                    >
                      公开分享
                    </button>
                  )}
                </div>
              </details>
            )}
          </div>
        }
      />
      {share && (
        <p className="report-caption">
          公开链接包含报告 IP：
          <a href={share} target="_blank" rel="noreferrer">
            打开分享
          </a>{" "}
          <input
            aria-label="分享链接"
            readOnly
            value={share}
            onFocus={(e) => e.target.select()}
          />
          <button
            onClick={() =>
              void revokeReportShares(uuid, shareRound)
                .then(() => setShare(""))
                .catch((e) => setError(String(e)))
            }
          >
            撤销本轮全部分享
          </button>
        </p>
      )}
      {rounds[0]?.state === "running" && picked?.id !== rounds[0].id && (
        <button
          className="report-active-banner"
          onClick={() => setSelection(rounds[0].id)}
        >
          新一轮测量中 · {rounds[0].counts.completed}/
          {rounds[0].counts.expected} · 查看进度
        </button>
      )}
      {round && <div className="report-round-health" aria-label="本轮完成情况">
        <span><strong>{round.counts.completed}/{round.counts.expected}</strong>任务已结束</span>
        <span><strong>{round.counts.ok}</strong>完整结果</span>
        <span><strong>{round.counts.partial}</strong>不完整结果</span>
        <span><strong>{round.counts.missing}</strong>缺少覆盖</span>
        <span><strong>{round.counts.failed}</strong>测量失败</span>
      </div>}
      {round && module === "routes" && <p className="report-caption">任务结束包含失败和未确认终点；终点是否到达以每条路径的实际观测为准。</p>}
      {!!rounds.length && (
        <div className="report-round-selector">
          <span>检测轮次</span>
          <button
            aria-label="上一轮"
            disabled={selectedIndex >= rounds.length - 1}
            onClick={() => setSelection(rounds[selectedIndex + 1].id)}
          >
            <ArrowLeft size={15} />
          </button>
          <select
            aria-label={`${moduleTitles[module]}历史轮次`}
            value={picked?.id || ""}
            onChange={(e) => setSelection(e.target.value)}
          >
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {formatNetworkTime(r.plannedAt)} · {reportLabels[r.state]}
                {r.detailAvailable ? "" : " · 明细已过期"}
              </option>
            ))}
          </select>
          <button
            aria-label="下一轮"
            disabled={selectedIndex <= 0}
            onClick={() => setSelection(rounds[selectedIndex - 1].id)}
          >
            <ArrowRight size={15} />
          </button>
          {history.hasNextPage && (
            <button
              disabled={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              更早轮次
            </button>
          )}
          {round?.state === "running" && (
            <button
              onClick={() =>
                void cancelReportRound(uuid, round.id)
                  .then(() => history.refetch())
                  .then(() => detail.refetch())
                  .catch((e) => setError(String(e.message)))
              }
            >
              取消本轮
            </button>
          )}
        </div>
      )}
      {(history.error || detail.error || error) && (
        <p role="alert">
          {error || history.error?.message || detail.error?.message}
        </p>
      )}
      {history.isPending && <p role="status">正在读取轮次…</p>}
      {!history.isPending && !rounds.length && (
        <div className="report-empty">
          <strong>尚无{moduleTitles[module]}报告</strong>
          <p>
            选择预设、执行时间和 VPS
            即可建立成组报告。缺少测量资源会记录覆盖原因。
          </p>
          <button onClick={onConfigure}>设置报告计划</button>
        </div>
      )}
      {round && !round.detailAvailable && (
        <div className="report-empty">
          本轮明细已超过七天保留期。完成度和每个目标的汇总保留九十天；原始样本无法恢复。
          <div className="report-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>目标</th>
                  <th>状态</th>
                  <th>保留的统计与条件</th>
                </tr>
              </thead>
              <tbody>
                {round.slots.map((s) => (
                  <tr key={s.id}>
                    <td>{s.endpoint?.name || s.target || s.id}</td>
                    <td>{reportLabels[s.state]}</td>
                    <td>
                      <pre>{JSON.stringify(s.metrics || {}, null, 2)}</pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {round?.detailAvailable &&
        (module === "nodequality-full" ? <FullNodeQualityReport round={round} /> : module === "tcpquality-full" ? <FullTcpQualityReport round={round} /> : ["international", "idc", "tcp-quality"].includes(module) ? (
          <LatencyMatrix
            key={round.id}
            round={round}
            onInspect={(slot, result) => setInspected({ slot, result })}
          />
        ) : module === "routes" ? (
          <MtrReport
            key={round.id}
            round={round}
            onInspect={(slot, result) => setInspected({ slot, result })}
          />
        ) : module.endsWith("speed") ? (
          <SpeedReport
            key={round.id}
            round={round}
            onInspect={(slot, result) => setInspected({ slot, result })}
          />
        ) : module === "bgp" ? (
          <BgpReport key={round.id} round={round} />
        ) : (
          <div className="report-empty">
            {round.measurements.map((r) => (
              <p key={r.id}>
                {r.data.diagnostic || reportLabels[r.data.state]}
              </p>
            ))}
          </div>
        ))}
      {round && module !== "routes" && module !== "bgp" && !["tcpquality-full", "nodequality-full"].includes(module) && rounds.length > 0 && <ReportHistory key={module} uuid={uuid} summaries={rounds} current={round} onSelect={setSelection} />}
      {inspected && (
        <NetworkDrawer
          title={
            inspected.slot.endpoint?.name || inspected.slot.target || "测量详情"
          }
          onClose={() => setInspected(null)}
        >
          <div className="network-form">
            <NetworkBadge
              state={inspected.result?.data.state || inspected.slot.state}
            >
              {
                reportLabels[
                  inspected.result?.data.state || inspected.slot.state
                ]
              }
            </NetworkBadge>
            <p>
              {sourceText(inspected.slot)} · {inspected.slot.direction}
            </p>
            <p>
              {inspected.result?.data.diagnostic ||
                inspected.slot.missingReason}
            </p>
            {inspected.slot.endpoint && (
              <>
                <p>{inspected.slot.endpoint.conditions}</p>
                <p>{inspected.slot.endpoint.restrictions}</p>
                <a
                  href={inspected.slot.endpoint.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  端点来源 · {inspected.slot.endpoint.checkedAt}
                </a>
              </>
            )}
            {inspected.result?.data.tcpQuality && (
              <p>
                成功 {inspected.result.data.tcpQuality.received}/
                {inspected.result.data.tcpQuality.sent} · 中位数{" "}
                {numberText(inspected.result.data.tcpQuality.medianMs)} ms ·
                均值 {numberText(inspected.result.data.tcpQuality.avgMs)} ms ·
                最小/最大 {numberText(inspected.result.data.tcpQuality.minMs)}/
                {numberText(inspected.result.data.tcpQuality.maxMs)} ms
              </p>
            )}
            {inspected.result?.data.https && (
              <p>
                独立 HTTPS 检查：
                {inspected.result.data.https.httpStatus
                  ? `HTTP ${inspected.result.data.https.httpStatus}`
                  : inspected.result.data.https.state}
                ；应用响应不代表登录或解锁可用。
              </p>
            )}
            <details>
              <summary>原始报告与测量条件</summary>
              <pre className="report-json">
                {JSON.stringify(inspected, null, 2)}
              </pre>
            </details>
          </div>
        </NetworkDrawer>
      )}
    </section>
  );
}
export function NetworkReportWorkspace({
  uuid,
  onConfigure,
  availableModules,
}: {
  uuid: string;
  onConfigure: () => void;
  availableModules: ReportModule[];
}) {
  const [tab, setTab] = useState<"routes" | "tcp-quality" | "speed" | "international">(
    (() => { const value = new URLSearchParams(window.location.search).get("tab"); return value === "routes" || value === "speed" || value === "tcp-quality" ? value : "international"; })(),
  );
  const tabs = {
    routes: ["routes", "bgp"],
    "tcp-quality": ["tcpquality-full", "nodequality-full", "tcp-quality"],
    speed: ["china-speed"],
    international: ["international", "idc", "international-speed"],
  } as const;
  return (
    <div className="network-report-workspace">
      <div className="report-workspace-heading">
        <div>
          <small>ASTER / 网络报告</small>
          <h3>
            <Activity size={20} />
            成组测量与历史报告
          </h3>
        </div>
        <button onClick={onConfigure}>
          <Settings2 size={16} />
          定时计划
        </button>
      </div>
      <div className="report-main-tabs" aria-label="网络报告标签">
        {(["routes", "tcp-quality", "speed", "international"] as const).map((key) => (
          <button
            key={key}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {{ routes: "路由", "tcp-quality": "TCP 质量", speed: "测速", international: "国际" }[key]}
          </button>
        ))}
      </div>
      {tabs[tab]
        .filter((m) => availableModules.includes(m))
        .map((module) => (
          <RoundModule
            key={module}
            module={module}
            uuid={uuid}
            onConfigure={onConfigure}
          />
        ))}
      {!tabs[tab].some((m) => availableModules.includes(m)) && (
        <div className="report-empty">
          此插件未提供本标签的报告能力，请升级网络观测插件。
        </div>
      )}
    </div>
  );
}
