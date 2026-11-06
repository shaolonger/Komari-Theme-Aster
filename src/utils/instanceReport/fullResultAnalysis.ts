import type { ReportFullResult } from "./model";

export interface FullResultRow {
  group: string;
  label: string;
  context: string;
  latency: number | null;
  loss: number | null;
  state: string;
}
export interface FullResultFact { group: string; label: string; value: string }
export interface FullResultAnalysis {
  rows: FullResultRow[];
  facts: FullResultFact[];
  sections: { label: string; format: string }[];
  notes: string[];
}

/** Also embedded in offline HTML. Keep every dependency inside this function. */
export function analyzeFullResult(result: ReportFullResult): FullResultAnalysis {
  const rows: FullResultRow[] = [], facts: FullResultFact[] = [], notes: string[] = [];
  const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
  const scalar = (v: unknown) => typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : "";
  const number = (v: unknown) => { const s = scalar(v).trim().replace(/%$/, ""); return s && /^\d+(?:\.\d+)?$/.test(s) && Number.isFinite(Number(s)) ? Number(s) : null; };
  const readCsv = (value: string) => {
    const all: string[][] = []; let row: string[] = [], cell = "", quoted = false;
    const source = value.replace(/^\uFEFF/, "");
    for (let i = 0; i < source.length; i++) {
      const c = source[i];
      if (c === '"') { if (quoted && source[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
      else if ((c === "," || c === "\n") && !quoted) { row.push(cell.replace(/\r$/, "")); cell = ""; if (c === "\n") { if (row.some(Boolean)) all.push(row); row = []; } }
      else cell += c;
    }
    row.push(cell.replace(/\r$/, "")); if (row.some(Boolean)) all.push(row); return all;
  };
  const add = (group: string, label: string, value: unknown) => { const text = scalar(value); if (text && !["null", "undefined", "N/A"].includes(text)) facts.push({ group, label, value: text }); };
  const walkStatuses = (value: unknown, group: string, path: string[], depth = 0) => {
    if (depth > 5) return;
    for (const [key, item] of Object.entries(object(value))) {
      if (/token|secret|password|command|github|^ip$|^time$|^version$/i.test(key)) continue;
      const next = [...path, key];
      if (item && typeof item === "object") { walkStatuses(item, group, next, depth + 1); continue; }
      if (/risk|score|type|provider|country|available|unlock|status|region|netflix|youtube|disney|chatgpt|风险|解锁|类型|状态|地区/i.test(next.join(" ")))
        add(group, next.join(" / "), typeof item === "boolean" ? item ? "是" : "否" : item);
    }
  };
  for (const section of result.sections) {
    if (section.format === "csv") {
      const [headers = [], ...data] = readCsv(section.text);
      const index = (...names: string[]) => headers.findIndex(h => names.some(n => h.trim().toLowerCase() === n.toLowerCase()));
      const find = (r: string[], ...names: string[]) => r[index(...names)] || "";
      for (const r of data) {
        const group = find(r, "网络", "分类", "category") || section.title;
        const label = [find(r, "省份", "测点", "节点", "地区", "region"), find(r, "运营商", "carrier")].filter(Boolean).join(" · ") || find(r, "域名", "domain", "服务", "service") || r[0] || "未命名测点";
        const state = find(r, "状态", "status");
        const received = number(find(r, "收到", "received"));
        const latency = number(find(r, "平均延迟ms", "平均延迟(ms)", "平均时延ms", "latency_ms", "rtt_ms", "avg_ms"));
        const loss = number(find(r, "丢包率(%)", "丢包率（%）", "丢包率", "loss_percent", "failure_percent"));
        const context = [find(r, "IP版本", "地址族", "family"), find(r, "线路", "route"), find(r, "iPerf3方向", "方向", "direction")].filter(Boolean).join(" · ");
        rows.push({ group, label, context, latency: received === 0 || (received == null && /^(?:FAIL|FAILED|ERROR|TIMEOUT)$/i.test(state)) ? null : latency, loss: loss != null && loss <= 100 ? loss : null, state });
      }
    }
    if (section.format !== "json") continue;
    let data: Record<string, unknown>;
    try { data = object(JSON.parse(section.text)); } catch { notes.push(`${section.title}的结构化内容不完整，原始结果另存于附录。`); continue; }
    if (section.name === "hardware_quality.json") {
      const cpu = object(data.CPU), memory = object(object(data.Memory).summary), disk = object(object(data.Disk).summary), os = object(data.OS);
      add("硬件与系统", "处理器", cpu.model); add("硬件与系统", "体系结构", cpu.architecture); add("硬件与系统", "系统", os.name); add("硬件与系统", "虚拟化", os.virtualization);
      add("硬件与系统", "逻辑线程", object(cpu.topology).threads); add("内存与磁盘", "内存容量（上游单位）", memory.total); add("内存与磁盘", "内存使用率 %", memory.used_percent);
      const total = number(disk.total_bytes); if (total != null) add("内存与磁盘", "磁盘容量 GB", (total / 1e9).toFixed(2));
      add("内存与磁盘", "磁盘使用率 %", disk.used_percent);
      const benches = object(data.Benchmark);
      for (const [key, label] of [["cpu", "CPU"], ["memory", "内存"], ["disk", "磁盘"], ["gpu", "GPU"]]) add("上游基准评分", label!, benches[key!]);
    } else if (section.name === "ip_quality.json") walkStatuses(data, "IP 属性与服务可达性", []);
    else if (section.name === "net_quality.json") {
      // Keep per-provider fields explicit. Do not manufacture a pooled network score.
      walkStatuses(data, "网络检测属性", []);
    } else if (section.name === "backroute_trace.json") {
      notes.push("回程路径按上游原图和原始记录保留，不从复杂路径对象猜测线路产品。");
    }
  }
  if (result.truncated) notes.push("本轮保存内容不完整，摘要只使用可解析字段；未保留的部分不补造。");
  if (!rows.length && !facts.length) notes.push("本轮未保留可归纳的结构化字段，请结合完整结果图与原报告阅读。");
  return { rows, facts, sections: result.sections.map(section => ({ label: section.title, format: section.format })), notes: [...new Set(notes)] };
}
