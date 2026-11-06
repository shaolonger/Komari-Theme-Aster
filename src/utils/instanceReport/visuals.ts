import type { ReportModel } from "./model";
const e = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const reportModuleLabels: Record<string, string> = { routes: "三网线路", "china-speed": "大陆测速", international: "国际连通", "international-speed": "国际测速", "tcp-quality": "TCP 质量", "tcpquality-full": "TcpQuality 完整检测", "nodequality-full": "NodeQuality 完整检测", idc: "IDC 互联", bgp: "BGP / RPKI" };
const tones = ["#3978ff", "#8b5cf6", "#14b8a6", "#f5a524", "#ef5b7d"];
export function reportDonut(title: string, rows: { label: string; value: number; color?: string }[], center: string, detail: string, formatValue = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 1 })) {
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.value), 0); let offset = 0;
  const arcs = rows.map((row, i) => { const amount = total ? Math.max(0, row.value) / total * 100 : 0, before = offset; offset += amount; return `<circle cx="72" cy="72" r="54" fill="none" stroke="${row.color || tones[i % tones.length]}" stroke-width="14" pathLength="100" stroke-dasharray="${amount} ${100 - amount}" stroke-dashoffset="${-before}" transform="rotate(-90 72 72)"/>`; }).join("");
  return `<figure class="visual-donut"><figcaption>${e(title)}</figcaption><div class="donut-layout"><svg viewBox="0 0 144 144" role="img" aria-label="${e(title)}"><circle cx="72" cy="72" r="54" fill="none" stroke="var(--line)" stroke-width="14"/>${arcs}<text x="72" y="71" text-anchor="middle" fill="var(--ink)" font-size="20" font-weight="700">${e(center)}</text><text x="72" y="91" text-anchor="middle" fill="var(--muted)" font-size="10">${e(detail)}</text></svg><div class="donut-legend">${rows.map((row, i) => `<span><i style="background:${row.color || tones[i % tones.length]}"></i><span>${e(row.label)}</span><strong>${e(formatValue(row.value))}</strong></span>`).join("")}</div></div></figure>`;
}
export function resourceRings(model: ReportModel) {
  const rows = [
    ["cpu", "CPU", "%", 100], ["ram", "内存", "B", model.node.memory], ["disk", "磁盘", "B", model.node.disk],
  ] as const;
  return `<div class="resource-rings">${rows.map(([key, label, unit, capacity], i) => {
    const value = model.stats[key]?.mean, percent = value != null && capacity > 0 ? Math.max(0, Math.min(100, value / capacity * 100)) : null;
    return `<figure><svg viewBox="0 0 160 125" role="img" aria-label="${e(label)}平均使用 ${percent == null ? "未知" : percent.toFixed(1) + "%"}"><circle cx="80" cy="64" r="45" fill="none" stroke="var(--line)" stroke-width="10"/><circle cx="80" cy="64" r="45" fill="none" stroke="${tones[i]}" stroke-width="10" pathLength="100" stroke-dasharray="${percent || 0} ${100 - (percent || 0)}" stroke-linecap="round" transform="rotate(-90 80 64)"/><text x="80" y="69" text-anchor="middle" fill="var(--ink)" font-size="21" font-weight="700">${percent == null ? "—" : percent.toFixed(1) + "%"}</text><text x="80" y="123" text-anchor="middle" fill="var(--muted)" font-size="12">${label} · 期间平均${unit === "B" ? " / 当前容量" : ""}</text></svg></figure>`;
  }).join("")}</div>`;
}
export function networkVisualSummary(model: ReportModel) {
  const buckets = { success: 0, partial: 0, failed: 0, unknown: 0 };
  for (const row of model.network) { if (["ok", "complete", "application"].includes(row.state)) buckets.success++; else if (row.state === "partial") buckets.partial++; else if (["failed", "timeout"].includes(row.state)) buckets.failed++; else buckets.unknown++; }
  const rows = [
    { label: "已完成", value: buckets.success, color: "#14b8a6" }, { label: "部分结果", value: buckets.partial, color: "#f5a524" }, { label: "检测失败", value: buckets.failed, color: "#ef5b7d" }, { label: "未完成 / 未知", value: buckets.unknown, color: "#9caec8" },
  ];
  const modules = [...new Set(model.network.map(row => row.module))];
  return `<div class="visual-grid">${reportDonut("网络观测完成情况", rows, String(model.network.length), "个测量项")}<figure class="module-coverage"><figcaption>各类检测的结果分布</figcaption>${modules.map(module => {
    const items = model.network.filter(row => row.module === module), good = items.filter(row => ["ok", "complete", "application"].includes(row.state)).length;
    return `<div><span>${e(reportModuleLabels[module] || module)}</span><div class="module-track"><i style="width:${items.length ? good / items.length * 100 : 0}%"></i></div><strong>${good} / ${items.length}</strong></div>`;
  }).join("") || '<p class="muted">暂无网络观测记录</p>'}<p class="muted">完成情况描述检测执行，不代表服务可用率。</p></figure></div>`;
}
export function trendExplorer(model: ReportModel) {
  const modules = [...new Set(model.networkTrends.map(trend => trend.module))];
  const priority = Object.keys(reportModuleLabels); modules.sort((a, b) => priority.indexOf(a) - priority.indexOf(b));
  if (!modules.length) return '<div class="note">当前范围没有可绘制的历史观测。</div>';
  const preferred = modules.find(module => model.networkTrends.some(trend => trend.module === module && trend.kind === "number") && model.networkTrends.some(trend => trend.module === module && trend.kind === "category"));
  if (preferred) { modules.splice(modules.indexOf(preferred), 1); modules.unshift(preferred); }
  return `<section class="network-trend-group trend-explorer"><div class="section-heading"><div><h3>网络观测历史趋势</h3><p class="muted">按检测类别与测点切换，每次仅显示两张图。</p></div><span class="soft-badge">${model.networkTrends.length} 条趋势可查看</span></div><div class="trend-controls"><label>检测类别<select data-trend-module>${modules.map(module => `<option value="${e(module)}">${e(reportModuleLabels[module] || module)}</option>`).join("")}</select></label><label>主要趋势<select data-trend-primary></select></label><label>对照趋势<select data-trend-secondary></select></label></div><div class="charts"><figure><figcaption data-trend-caption="primary"></figcaption><div class="chart" data-explorer-chart="primary"></div></figure><figure><figcaption data-trend-caption="secondary"></figcaption><div class="chart" data-explorer-chart="secondary"></div></figure></div><p class="muted">各测点、方向和协议独立显示；空白表示缺测。图中可查看具体观测，不混合不同测量方法。</p><details class="technical-details"><summary>查看当前两条趋势的观测明细</summary><div data-trend-details></div></details></section>`;
}
export function pingComparison(model: ReportModel) {
  const rows = model.pings.filter(ping => model.pingStats[ping.id]?.mean != null).slice(0, 8), max = Math.max(1, ...rows.map(ping => model.pingStats[ping.id]!.mean || 0));
  return `<figure class="module-coverage"><figcaption>各任务的成功时延</figcaption>${rows.map(ping => { const value = model.pingStats[ping.id]!.mean!; return `<div><span>${e(ping.name)}</span><div class="module-track"><i style="width:${value / max * 100}%"></i></div><strong>${value.toFixed(1)} ms</strong></div>`; }).join("") || '<p class="muted">没有可比较的成功探测样本。</p>'}<p class="muted">每条任务独立统计，完整记录可在明细中查看。</p></figure>`;
}
export function fullResultGallery(model: ReportModel) {
  if (!model.fullResults?.length) return "";
  return `<section class="full-result-gallery" id="report-original-results"><div class="section-heading"><div><span class="eyebrow">ORIGINAL RESULT APPENDIX</span><h3>完整测评截图与原始结果</h3><p class="muted">TcpQuality / NodeQuality 按轮次归档；原始版保留完整截图，统一版按测点和内容归纳。所选图片内嵌于 HTML / PDF，下载整图不切割。</p></div><span class="soft-badge">${model.fullResults.length} 份结果</span></div><div class="result-controls"><label>图片样式<select data-result-style aria-label="结果图片样式"><option value="unified"${model.resultStyle !== "original" ? " selected" : ""}>统一图表版</option><option value="original"${model.resultStyle === "original" ? " selected" : ""}>上游原始版 · 测评截图</option></select></label><label>查找结果<input data-result-search type="search" placeholder="类别、日期或轮次" aria-label="查找检测结果"></label></div><div class="result-selection"><button data-results-latest>每类最新一份</button><button data-results-all>选择全部</button><button data-results-clear>清空选择</button><strong data-results-count></strong></div><div data-result-list class="result-list"></div><div class="result-pagination"><button data-results-prev>上一页</button><span data-results-page></span><button data-results-next>下一页</button></div><div class="result-export-actions"><button class="primary" data-results-preview>预览所选结果</button><button data-results-zip>下载高清图片 ZIP</button><button data-save-html>下载含图片 HTML</button><button data-print>打印 / 存为 PDF</button><button data-results-cancel hidden>取消</button></div><p class="result-progress" role="status" aria-live="polite" data-results-status></p><div class="result-images" data-result-images></div></section>`;
}
