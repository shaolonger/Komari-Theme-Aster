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
import "@/styles/network-reports.css";

const moduleTitles: Record<ReportModule, string> = {
  routes: "大陆路由",
  "china-speed": "大陆单连接测速",
  international: "国际延迟",
  idc: "常见 IDC 延迟",
  "international-speed": "国际单连接测速",
  bgp: "全球 BGP 路径快照",
};
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
      <div className="report-latency-grid">
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
                aria-label="本轮十次 TCP 建连样本"
              >
                {Array.from({ length: 10 }, (_, i) => {
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
              key={e.asn}
              title={`AS${e.asn}；证据跳号 ${e.ttls.join(", ")}；规则 ${e.ruleVersion}`}
            >
              {e.label}
            </span>
          ))}
        </div>
      )}
      {!!hops.length && (
        <div className="report-table-scroll">
          <table className="report-mtr-table">
            <thead>
              <tr>
                {[
                  "跳",
                  "ASN / 网络",
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
                      <strong>
                        {hop.asn
                          ? "AS" +
                            hop.asn.replace(/AS/g, "").replace(/ /g, " / AS")
                          : hop.address
                            ? "未取得公网 AS 归属"
                            : "未响应"}
                      </strong>
                      <small>{hop.network || hop.location || ""}</small>
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
        ASN，不认证 GIA 等商业产品。
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
  const [selection, setSelection] = useState<string | null>(null),
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
    rounds.find((r) => r.state === "complete" && r.detailAvailable) ||
    rounds[0];
  const detail = useQuery({
    queryKey: ["report-round", uuid, picked?.id],
    queryFn: () => getReportRound(uuid, picked!.id),
    enabled: !!picked,
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
      for (const policy of policies) await runReportSuite(policy.id, module);
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
                  <button onClick={() => exportReportPng(round)}>
                    汇总 PNG
                  </button>
                  {round?.detailAvailable && round.state !== "running" && (
                    <button
                      title="创建七天以内的公开链接，包含目标和路由 IP"
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
        (["international", "idc"].includes(module) ? (
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
  const [tab, setTab] = useState<"routes" | "speed" | "international">(
    "international",
  );
  const tabs = {
    routes: ["routes", "bgp"],
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
        {(["routes", "speed", "international"] as const).map((key) => (
          <button
            key={key}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {{ routes: "路由", speed: "测速", international: "国际" }[key]}
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
          此插件尚未提供本标签的新版轮次能力；下方可读取旧版报告。
        </div>
      )}
    </div>
  );
}
