import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { getReportRound, type ReportRound, type ReportSlot, type RoundSummary } from "@/services/reportObservatory";
import { formatNetworkTime } from "./shared";
import { numberText } from "./reportMetrics";

export function historyPoint(round: ReportRound, slotId: string, metric: string) {
  const slot = round.slots.find(s => s.id === slotId);
  const data = round.measurements.find(m => m.slotId === slotId)?.data;
  const saved = slot?.metrics || {};
  let value: unknown = null;
  const run = data?.runs?.find(r => r.streams === 1 && r.vpsDirection === metric) ||
    (Array.isArray(saved.runs) ? saved.runs as NonNullable<typeof data>["runs"] : [])?.find(r => r.streams === 1 && r.vpsDirection === metric);
  if (slot && ["ok", "partial"].includes(slot.state)) {
    if (metric === "download" || metric === "upload") value = run && ["ok", "partial"].includes(run.state) ? run.bitsPerSecond : null;
    else if (metric === "failure") {
      const sent = data?.tcpQuality?.sent ?? saved.sent, received = data?.tcpQuality?.received ?? saved.received;
      if (typeof sent === "number" && sent > 0 && typeof received === "number") value = (sent - received) * 100 / sent;
    } else value = data?.tcpQuality?.medianMs ?? saved.medianMs;
  }
  const valid = typeof value === "number" && Number.isFinite(value) && value >= 0;
  const actual = data?.actualEndpoint || saved.actualEndpoint;
  const fingerprint = JSON.stringify([slot?.target, slot?.source.provider, slot?.source.id,
    round.parameters.family, actual, run?.measurementBasis || run?.intervalSource || data?.method || saved.method]);
  return { id: round.id, at: round.plannedAt, value: valid ? Number(value) / (metric === "download" || metric === "upload" ? 1e6 : 1) : null, fingerprint };
}

export function ReportHistory({ uuid, summaries, current, onSelect }: {
  uuid: string; summaries: RoundSummary[]; current: ReportRound; onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [slotId, setSlotId] = useState(""), [metric, setMetric] = useState(current.module.endsWith("speed") ? "download" : "median");
  const selected = current.slots.find(s => s.id === slotId) || current.slots[0];
  const history = summaries.filter(r => r.state !== "running").slice(0, 8);
  const queries = useQueries({ queries: history.map(summary => ({
    queryKey: ["report-round", uuid, summary.id], queryFn: () => getReportRound(uuid, summary.id), staleTime: 60000, enabled: open,
  })) });
  const points = queries.map((q, i) => q.data ? historyPoint(q.data, selected?.id || "", metric) :
    { id: history[i].id, at: history[i].plannedAt, value: null, fingerprint: "" }).reverse();
  const maximum = Math.max(1, ...points.map(p => p.value ?? 0));
  const coordinates = points.map((p, i) => ({ ...p, x: 20 + i * 560 / Math.max(1, points.length - 1), y: 115 - (p.value ?? 0) * 95 / maximum }));
  const speed = current.module.endsWith("speed"), unit = speed ? "Mbps" : metric === "failure" ? "%" : "ms";
  const changed = points.some((p, i) => i > 0 && p.value !== null && points[i - 1].value !== null && p.fingerprint !== points[i - 1].fingerprint);
  const name = (slot: ReportSlot) => [slot.source.city, slot.source.carrier, slot.endpoint?.name || slot.target || slot.id].filter(Boolean).join(" · ");
  return <details className="report-history" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>历史趋势 · 最近 {history.length} 轮 · {speed ? "P1" : "TCP 建连"}</summary>
    <div className="report-history-controls">
      <label>测量目标<select value={selected?.id || ""} onChange={e => setSlotId(e.target.value)}>{current.slots.map(s => <option key={s.id} value={s.id}>{name(s)}</option>)}</select></label>
      <label>指标<select value={metric} onChange={e => setMetric(e.target.value)}>{(speed ? [["download", "VPS 下载"], ["upload", "VPS 上传"]] : [["median", "建连中位数"], ["failure", "建连失败率"]]).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </div>
    <p className="report-caption">失败和缺测留空。每一点对应独立轮次，可点击打开；测量端点或计量方法变化时断开连线。汇总保留 90 天，原始样本保留 7 天。</p>
    {changed && <p className="report-caption">这些轮次存在端点或测量条件变化，请展开对应报告核对可比性。</p>}
    {queries.some(q => q.isError) && <p role="status">部分历史轮次读取失败，曲线保留空位。</p>}
    <svg className="report-history-chart" viewBox="0 0 600 140" role="img" aria-label={`历史${unit}趋势，最大 ${numberText(maximum)}`}>
      <text x="5" y="12">{numberText(maximum)} {unit}</text>
      <line x1="20" x2="580" y1="116" y2="116" />
      {coordinates.map((p, i) => <g key={p.id}>
        {i > 0 && p.value !== null && coordinates[i - 1].value !== null && p.fingerprint === coordinates[i - 1].fingerprint && <line x1={coordinates[i - 1].x} y1={coordinates[i - 1].y} x2={p.x} y2={p.y} />}
        {p.value !== null && <circle cx={p.x} cy={p.y} r="5" role="button" tabIndex={0} aria-label={`${formatNetworkTime(p.at)} ${numberText(p.value)} ${unit}`} onClick={() => onSelect(p.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(p.id); } }}><title>{formatNetworkTime(p.at)} · {numberText(p.value)} {unit}</title></circle>}
      </g>)}
    </svg>
    <div className="report-history-values">{points.map(p => <button key={p.id} onClick={() => onSelect(p.id)}><small>{formatNetworkTime(p.at)}</small><strong>{numberText(p.value)} {unit}</strong></button>)}</div>
  </details>;
}
