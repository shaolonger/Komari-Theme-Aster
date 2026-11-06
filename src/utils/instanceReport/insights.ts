import type { ReportModel } from "./model";
import { analyzeFullResult } from "./fullResultAnalysis";

export interface ReportAction {
  id: string;
  priority: "review" | "watch" | "info";
  chapter: string;
  title: string;
  observation: string;
  evidence: string;
  recommendation: string;
  verification: string;
  time?: number;
}
export interface ReportAnalysis {
  title: string;
  detail: string;
  resource: string;
  resourceDetail: string;
  network: string;
  networkDetail: string;
  traffic: string;
  trafficDetail: string;
  focusPingId: number | null;
  actions: ReportAction[];
  lines: { id: number; label: string; protocol: string; mean: number | null; loss: number | null; sent: number; priority: "review" | "watch" | "clear" | "unknown" }[];
}

/** Deterministic conclusions from observed data, never from execution counts or a health score. */
export function analyzeReport(model: ReportModel): ReportAnalysis {
  const actions: ReportAction[] = [];
  const span = model.range.end - model.range.start;
  const rank = { review: 0, watch: 1, info: 2, clear: 3, unknown: 4 };
  const lines = model.pings.map(ping => {
    const s = model.pingStats[ping.id];
    const loss = s?.loss ?? null;
    const priority: ReportAnalysis["lines"][number]["priority"] = loss == null ? "unknown" : loss >= .03 ? "review" : loss >= .01 ? "watch" : "clear";
    return { id: ping.id, label: ping.name, protocol: ping.protocol, mean: s?.mean ?? null, loss, sent: s?.sent ?? 0, priority };
  }).sort((a,b) => rank[a.priority] - rank[b.priority] || (b.loss ?? -1) - (a.loss ?? -1) || a.label.localeCompare(b.label));
  for (const row of lines.filter(row => row.priority === "review" || row.priority === "watch")) {
    const ping = model.pings.find(p => p.id === row.id)!;
    actions.push({ id: `ping-${row.id}`, priority: row.priority as "review" | "watch", chapter: "network", title: `${row.label}需要${row.priority === "review" ? "优先复测" : "持续观察"}`,
      observation: `${row.sent.toLocaleString()} 次探测中失败率为 ${((row.loss ?? 0)*100).toFixed(2)}%；成功时延${row.mean == null ? "不可计算" : `均值 ${row.mean.toFixed(2)} ms`}。`,
      evidence: `Ping 任务 ${row.id} · ${row.protocol} · 所选期间`, recommendation: "在相同目标、协议和时段复测，对照其他独立任务及路由，确认差异是否重复。", verification: "保留复测时间、目标与结果；结合业务探测确认影响范围后再决定后续处理。", time: ping.points.find(p => p.lost > 0)?.t });
  }
  const available: string[] = [], missing: string[] = [];
  for (const [key, label, limit, capacity] of [["cpu","CPU",model.rules.cpu,100],["ram","内存",model.rules.memory,model.node.memory],["disk","磁盘",model.rules.disk,model.node.disk]] as const) {
    const stats = model.stats[key], metric = model.metrics.find(m => m.key === key);
    if (!stats || stats.max == null || !capacity || !metric) { missing.push(label); continue; }
    available.push(label);
    if (stats.max / capacity * 100 > limit) actions.push({ id: `resource-${key}`, priority: "watch", chapter: "resources", title: `${label}存在高值返回点`, observation: `最高返回点换算为 ${(stats.max/capacity*100).toFixed(1)}%，超过本报告参考阈值 ${limit}%；数据精度为${metric.precision}。`, evidence: `${label}历史 · 所选期间${key === "cpu" ? "" : " / 当前容量分母"}`, recommendation: "检查对应时段任务及日志，判断高值是否重复出现，并结合实际业务容量需求评估。", verification: "有连续采样和业务证据后再判断持续超限；当前返回点不能证明瞬时峰值或故障根因。", time: metric.points.find(p => p.v === stats.max)?.t });
  }
  // Latest numeric evidence per identical method/target; never average different probes.
  const latest = new Map<string, typeof model.network[number]>();
  const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  for (const e of model.network) {
    const data=object(e.detail),tcp=object(data.tcpQuality);
    const key = JSON.stringify([e.module,e.family,e.city,e.carrier,e.provider,e.protocol,e.direction,e.targetRef || e.target,e.source,data.method,tcp.method]);
    if (!latest.has(key) || latest.get(key)!.time < e.time) latest.set(key,e);
  }
  for (const e of latest.values()) {
    const data = object(e.detail), tcp = object(data.tcpQuality);
    const loss = tcp.failurePercent ?? data.failurePercent ?? data.lossPercent;
    if (typeof loss !== "number" || !Number.isFinite(loss) || loss < 1 || loss > 100) continue;
    const name = [e.city,e.carrier,e.family ? `IPv${e.family}` : "",e.protocol,e.direction].filter(Boolean).join(" · ") || e.module;
    const moduleName=({"tcp-quality":"TCP 质量","international-connectivity":"国际连通","routes":"路由"} as Record<string,string>)[e.module]||e.module;
    const shortName=[!e.city&&!e.carrier?moduleName:"",e.city,e.carrier,e.family?`IPv${e.family}`:"",e.targetRef].filter(Boolean).join(" / ");
    actions.push({ id: `observation-${e.id}`, priority: loss >= 3 ? "review" : "watch", chapter: "network", title: `${shortName}的最新观测需复核`, observation: `${name}最新可读观测的失败 / 丢包比例为 ${loss.toFixed(2)}%；这是单次检测结果。`, evidence: `${e.module} · ${e.source} · ${e.id}${e.summaryOnly ? " · 仅保留摘要" : ""}`, recommendation: "使用同一测点、方向和方法复测，核对端点及执行状态；中间跳丢包需由终点证据确认。", verification: "确认结果能够重复，并记录与其他方法之间的差异；不同协议和目标分别解释。", time: e.time });
  }
  const latestFull = [...new Map([...(model.fullResults || [])].sort((a,b)=>a.time-b.time).map(r=>[r.module,r])).values()];
  for (const result of latestFull) {
    const flagged = analyzeFullResult(result).rows.filter(row => row.loss != null && row.loss >= 3).sort((a,b)=>b.loss!-a.loss!);
    if (!flagged.length) continue;
    const first = flagged[0]!;
    actions.push({ id: `full-${result.id}`, priority: "review", chapter: "network", title: `${result.module === "tcpquality-full" ? "TcpQuality" : "NodeQuality"} 有测点需复核`, observation: `最新一轮可解析结果中，${flagged.length} 个测点的失败 / 丢包比例达到 3%；其中 ${first.label} 为 ${first.loss!.toFixed(2)}%。`, evidence: `完整检测轮次 ${result.roundId} · 原报告及图片见附录`, recommendation: "打开本轮完整结果，检查测点、地址族和执行状态，再按相同条件复测。", verification: "完整检测是单次快照，不能据此推断整个报告期间的网络表现。", time: result.time });
  }
  if (model.traffic.resets) actions.push({ id: "traffic-reset", priority: "watch", chapter: "traffic", title: "流量计数器回退，期间量需要谨慎解读", observation: `${model.traffic.resets} 个回退段未计入已观测流量，实际用量可能更高。`, evidence: "累计上传 / 下载计数器", recommendation: "对照供应商统计周期及账单，确认计费方向；保留当前档案。", verification: "计数器回退不能单独证明节点重启，也不能用于恢复已缺失的用量。" });
  const restricted = model.sources.filter(s=>["partial","failed","forbidden"].includes(s.state));
  if (restricted.length || (model.stats.cpu?.gaps.length ?? 0)) actions.push({ id: "data-coverage", priority: "info", chapter: "sources", title: "部分结论受到数据覆盖限制", observation: `${restricted.length ? `${restricted.map(s=>s.name).join("、")}读取受限。` : ""}${model.stats.cpu?.gaps.length ? "CPU 采集存在未知时段。" : ""}`, evidence: "数据来源与采集缺口索引", recommendation: "先查看各来源的实际观测时间和精度，必要时缩短报告范围或补充探测。", verification: "缺测保留为未知，不补零，不认定为停机或健康。" });
  // Within the same attention level, sustained observations precede snapshots.
  const evidenceOrder=(id:string)=>id.startsWith("ping-")?0:id.startsWith("resource-")?1:id.startsWith("full-")?2:id.startsWith("observation-")?3:4;
  const pingLoss=(id:string)=>lines.find(line=>`ping-${line.id}`===id)?.loss??0;
  actions.sort((a,b)=>rank[a.priority]-rank[b.priority] || evidenceOrder(a.id)-evidenceOrder(b.id) || pingLoss(b.id)-pingLoss(a.id) || (b.time ?? 0)-(a.time ?? 0) || a.id.localeCompare(b.id));
  const resourceWarning = actions.some(a=>a.chapter === "resources");
  const adequate = available.length === 3 && ["cpu","ram","disk"].every(key=>model.stats[key]!.count>1 && model.stats[key]!.coveredMs/span>=.8);
  const resource = resourceWarning ? "资源高值需要留意" : adequate ? "已有资源指标未触发规则" : available.length ? "资源结论受覆盖限制" : "暂无资源历史可分析";
  const resourceDetail = missing.length ? `缺少${missing.join("、")}历史，无法完整判断资源余量。` : "依据返回点与当前容量换算；未推断连续超限时长。";
  const networkActions = actions.filter(a=>a.chapter === "network");
  const network = networkActions.length ? networkActions[0]!.title : lines.some(l=>l.sent>0) ? "已有 Ping 样本未触发规则" : latestFull.length || model.network.length ? "单次检测供独立参考" : "暂无网络体验证据";
  const traffic = model.traffic.up == null && model.traffic.down == null ? "期间流量不可计算" : model.traffic.partial ? "期间流量为已观测下界" : "期间流量可独立回顾";
  return { title: actions.find(a=>a.priority === "review")?.title || actions.find(a=>a.priority === "watch")?.title || resource,
    detail: `${resource}；${traffic}。持续探测与单次测评分别解释，数据不足的部分保留为未知。`, resource, resourceDetail, network,
    networkDetail: "持续 Ping 与单次检测分别统计；任务完成情况不代表服务可用率。", traffic,
    trafficDetail: "期间计数器增量与生成时套餐快照分别呈现，不替代供应商账单。", focusPingId: lines.find(row=>row.sent>0)?.id ?? null, actions, lines };
}
