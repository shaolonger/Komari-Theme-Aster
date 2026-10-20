import { CHAPTERS, METRIC_FIELDS } from "./model";
import type { EvidenceValue, ReportMetric, ReportModel } from "./model";
import { readerRuntime } from "./readerRuntime";
import { reportCss } from "./reportCss";

export const escapeHtml = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function safeJson(value: unknown) {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
export function formatReportValue(v: number | null | undefined, unit = "") {
  if (v == null || !Number.isFinite(v)) return "—";
  if (unit === "B" || unit === "B/s") {
    const exponent =
      v > 0
        ? Math.min(4, Math.max(0, Math.floor(Math.log(v) / Math.log(1024))))
        : 0;
    return `${(v / 1024 ** exponent).toFixed(2)} ${["B", "KiB", "MiB", "GiB", "TiB"][exponent]}${unit === "B/s" ? "/s" : ""}`;
  }
  return `${v.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}${unit ? " " + unit : ""}`;
}
const e = escapeHtml,
  f = formatReportValue;
const table = (heads: string[], rows: (string | number)[][]) =>
  `<div class="table-wrap"><table><thead><tr>${heads.map((h) => `<th scope="col">${e(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${e(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const note = (text: string) => `<div class="note">${e(text)}</div>`;
const summary = (title: string, text: string) =>
  `<div class="summary"><strong>${e(title)}</strong><p>${e(text)}</p></div>`;
const stat = (label: string, value: string, detail: string) =>
  `<div class="kpi"><div class="kpi-label">${e(label)}</div><div class="kpi-value">${e(value)}</div><div class="kpi-detail">${e(detail)}</div></div>`;
const definitions = (fields: [string, string][]) =>
  `<div class="definitions">${fields.map(([k, v]) => `<div class="definition"><span>${e(k)}</span><strong>${e(v || "未知")}</strong></div>`).join("")}</div>`;
const div = '<div class="divider"></div>';
const stateLabels: Record<string, string> = {
  available: "有数据",
  partial: "部分覆盖",
  empty: "范围内无数据",
  unavailable: "未提供",
  forbidden: "无权限",
  failed: "查询失败",
};
const networkLabels: Record<string, string> = {
  routes: "三网路由",
  route: "路由",
  "china-speed": "大陆测速",
  international: "国际连通",
  "international-speed": "国际测速",
  idc: "IDC 互联",
  bgp: "BGP / RPKI",
  website: "HTTPS 网站",
  https: "HTTPS",
  benchmark: "测速",
  speedtest: "测速",
};
const measurementLabels: Record<string, string> = {
  ok: "成功",
  complete: "已完成",
  partial: "部分结果",
  missing: "缺测",
  failed: "测量失败",
  cancelled: "已取消",
  running: "进行中",
  timeout: "超时",
  application: "应用响应",
  summary: "保留摘要",
};
function networkLabel(module: string) {
  const [kind = "", ...suffix] = module.split(" · ");
  return [networkLabels[kind] || kind, ...suffix].join(" · ");
}
function evidenceObject(v: EvidenceValue | undefined): {
  [key: string]: EvidenceValue;
} {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

export function renderReportHtml(model: ReportModel) {
  const date = (t: number | null | undefined) =>
    t != null && Number.isFinite(t)
      ? new Intl.DateTimeFormat("zh-CN", {
          timeZone: model.range.timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(t)
      : "未知";
  const metric = (key: string) => model.metrics.find((m) => m.key === key);
  const value = (
    key: string,
    what: "mean" | "min" | "max" | "p95" | "first" | "last" = "mean",
  ) => f(model.stats[key]?.[what], metric(key)?.unit);
  const noData =
    "所选期间没有可用数据。请查看数据口径中的来源状态、权限与保留限制。";
  const coverage = (key: string) =>
    model.stats[key]
      ? `${((model.stats[key]!.coveredMs / (model.range.end - model.range.start)) * 100).toFixed(1)}%`
      : "—";
  const kpis = `<div class="kpis">${stat("CPU · 返回点时间加权均值", value("cpu"), metric("cpu")?.precision ?? "未采集")}${stat("内存 · 返回点时间加权均值", value("ram"), "容量配置为生成时快照")}${stat("期间已观测总流量", model.traffic.up != null && model.traffic.down != null ? f(model.traffic.up + model.traffic.down, "B") : "—", "计数器差分 · 可能低估")}${stat("可见 Ping 任务", String(model.pings.length), "各任务独立统计")}</div>`;
  const findings = (limit: number) =>
    model.findings
      .slice(0, limit)
      .map(
        (item) =>
          `<div class="finding"><span class="finding-label">${item.severity === "warning" ? "关注" : "数据"}</span><div>${e(item.title)}<p>${e(item.detail)}</p></div><button type="button" data-jump="${e(item.chapter)}">查看证据 →</button></div>`,
      )
      .join("") ||
    note("已有数据未触发当前规则；未知时段和未提供的指标不计为正常。");
  const chart = (key: string, title?: string) => {
    const m = metric(key),
      p = key.startsWith("ping:")
        ? model.pings.find((p) => p.id === Number(key.slice(5)))
        : undefined;
    if (!m && !p) return "";
    return `<figure><figcaption>${e(title || m?.label || p?.name)}</figcaption><div class="chart" data-chart="${e(key)}"><p class="muted">图表正在准备，返回点可在数据表与 JSON 查看。</p></div><p class="muted">${e(m?.precision || "成功探测时延 · 按样本权重统计")} · 缺测不连接</p></figure>`;
  };
  const chartTable = (m: ReportMetric) =>
    `<details class="chart-tables"><summary>${e(m.label)} · 返回点数据表（${m.points.length} 点）</summary>${m.points.length > 200 ? note("表格展示前 200 个返回点。完整返回点已保存在本文件内，可通过“数据 JSON”导出查看。") : ""}${table(
      ["时间", "观测值", "桶样本数（若提供）"],
      m.points
        .slice(0, 200)
        .map((p) => [date(p.t), f(p.v, m.unit), p.n ?? "未知"]),
    )}</details>`;

  const overview =
    summary(
      model.stats.cpu?.count
        ? `已观测到的 CPU 均值为 ${value("cpu")}。`
        : "这份档案保留了所选日期内可读取的数据。",
      "先看趋势与线索，再查看每个章节。未采集、过期、无权限与查询失败均单独列明；配置与当前状态是生成时快照。",
    ) +
    kpis +
    `<div class="charts">${chart("cpu", "CPU 使用趋势")}${model.pings[0] ? chart(`ping:${model.pings[0].id}`, model.pings[0].name) : chart("ram", "内存使用趋势")}</div>` +
    div +
    "<h3>值得留意的发现</h3>" +
    findings(4) +
    note(
      `CPU 采集估计覆盖 ${coverage("cpu")}；覆盖依据返回点间距，不等于服务在线率。统计区间：${date(model.range.start)} — ${date(model.range.end)}。`,
    );

  const gauges = model.metrics.filter(
    (m) =>
      !m.key.startsWith("net_total") && !["net_in", "net_out"].includes(m.key),
  );
  const resources =
    summary(
      "资源使用、容量与连接数一并回顾。",
      "均值按推断采样间距加权且不跨缺口；分位数和峰值只描述返回点或桶均值，无法还原原始瞬时分布。",
    ) +
    (gauges.length
      ? `<div class="charts">${gauges
          .filter((m) =>
            ["cpu", "ram", "disk", "load", "process", "connections"].includes(
              m.key,
            ),
          )
          .map((m) => chart(m.key))
          .join("")}</div>` +
        table(
          ["指标", "有效点", "加权均值", "返回点峰值", "返回点 P95", "精度"],
          gauges.map((m) => [
            m.label,
            model.stats[m.key]?.count ?? 0,
            value(m.key),
            value(m.key, "max"),
            value(m.key, "p95"),
            m.precision,
          ]),
        ) +
        gauges.map(chartTable).join("")
      : note(noData)) +
    note(
      `GPU、温度、Swap、IO/IOPS、硬盘健康、容器、每进程资源和应用日志仅在数据源明确提供时可分析。本次${model.node.swap === 0 ? "容量快照显示 Swap 为 0，不能据此断言历史一直没有 Swap。" : "Swap 容量仅代表生成时配置。"}`,
    );

  const pingRows = model.pings.map((p) => {
    const s = model.pingStats[p.id]!;
    return [
      p.name,
      p.protocol,
      p.target || "未公开",
      f(s.mean, "ms"),
      s.sent
        ? `${s.lost} / ${s.sent} · ${f((s.loss ?? 0) * 100, "%")}`
        : "无样本",
    ];
  });
  const pingCharts = model.pings
    .map((p) => chart(`ping:${p.id}`, `${p.name} · ${p.protocol}`))
    .join("");
  const networkModules = [...new Set(model.network.map((n) => n.module))];
  const networkDetail = networkModules
    .map((module) => {
      const rows = model.network.filter((n) => n.module === module);
      return (
        `<h3>${e(networkLabel(module))}</h3>` +
        table(
          ["测量时间", "状态", "方向 / 来源", "目标"],
          rows.map((r) => [
            date(r.time),
            (measurementLabels[r.state] || r.state) +
              (r.summaryOnly ? " · 仅摘要" : ""),
            `${r.direction} / ${r.source}`,
            r.target || "未提供",
          ]),
        ) +
        rows
          .map((r) => {
            const data = evidenceObject(r.detail),
              hops = Array.isArray(data.hops)
                ? data.hops.map(evidenceObject)
                : [],
              runs = Array.isArray(data.runs)
                ? data.runs.map(evidenceObject)
                : [];
            const q = evidenceObject(data.tcpQuality),
              https = evidenceObject(data.https);
            const paths = Array.isArray(data.paths)
                ? data.paths.map(evidenceObject)
                : [],
              rpki = Array.isArray(data.rpki)
                ? data.rpki.map(evidenceObject)
                : [];
            return (
              `<details><summary>${e(date(r.time))} · ${e(r.direction || networkLabel(r.module))} · ${e(r.id)}${r.summaryOnly ? "（明细不可用或保留摘要）" : " · 测量证据"}</summary>` +
              (r.startedAt != null && r.startedAt < model.range.start
                ? note(
                    "本次测量跨越区间起点，仅按区间内的完成时间归档；测量耗时可能包含区间外时间。",
                  )
                : "") +
              (hops.length
                ? table(
                    ["跳数", "地址", "AS", "平均 / 返回时延", "丢包"],
                    hops.map((h) => [
                      String(h.ttl ?? "—"),
                      String(h.address ?? "未知"),
                      String(h.asn ?? "未知"),
                      f(
                        typeof h.avgMs === "number"
                          ? h.avgMs
                          : typeof h.rttMs === "number"
                            ? h.rttMs
                            : null,
                        "ms",
                      ),
                      f(
                        typeof h.lossPercent === "number"
                          ? h.lossPercent
                          : null,
                        "%",
                      ),
                    ]),
                  ) +
                  note(
                    "中间跳点丢包不能直接判为端到端丢包；完整跳点和终点确认信息见下方证据。",
                  )
                : "") +
              (runs.length
                ? table(
                    ["VPS 方向", "连接数", "平均速率", "测量时长", "重传"],
                    runs.map((run) => [
                      String(run.vpsDirection ?? run.direction ?? "未知"),
                      String(run.streams ?? "未知"),
                      f(
                        typeof run.bitsPerSecond === "number"
                          ? run.bitsPerSecond / 1e6
                          : null,
                        "Mbps",
                      ),
                      f(
                        typeof run.seconds === "number" ? run.seconds : null,
                        "s",
                      ),
                      String(run.retransmits ?? "未知"),
                    ]),
                  )
                : "") +
              (Object.keys(q).length
                ? table(
                    ["TCP 方法", "接收 / 发送", "平均 / 中位数", "失败率"],
                    [
                      [
                        String(q.method ?? data.method ?? "未知"),
                        `${q.received ?? "—"} / ${q.sent ?? "—"}`,
                        `${f(typeof q.avgMs === "number" ? q.avgMs : null, "ms")} / ${f(typeof q.medianMs === "number" ? q.medianMs : null, "ms")}`,
                        f(
                          typeof q.failurePercent === "number"
                            ? q.failurePercent
                            : null,
                          "%",
                        ),
                      ],
                    ],
                  )
                : "") +
              (Object.keys(https).length || data.httpStatus != null
                ? definitions([
                    [
                      "HTTP 状态",
                      String(https.httpStatus ?? data.httpStatus ?? "未知"),
                    ],
                    [
                      "TLS 验证",
                      String(https.tlsVerified ?? data.tlsVerified ?? "未知"),
                    ],
                  ])
                : "") +
              (paths.length
                ? table(
                    ["BGP 来源", "AS 路径", "观测时间"],
                    paths.map((p) => [
                      String(p.source ?? "未知"),
                      Array.isArray(p.path)
                        ? p.path.map(String).join(" → ")
                        : "未知",
                      String(p.observedAt ?? "未知"),
                    ]),
                  )
                : "") +
              (rpki.length
                ? table(
                    ["AS", "RPKI 状态", "验证来源 / 时间"],
                    rpki.map((p) => [
                      String(p.asn ?? "未知"),
                      String(p.state ?? "未知"),
                      `${p.validator ?? "未知"} / ${p.queriedAt ?? "未知"}`,
                    ]),
                  )
                : "") +
              `<pre>${e(JSON.stringify(r.detail, null, 2))}</pre></details>`
            );
          })
          .join("")
      );
    })
    .join(div);
  const network =
    summary(
      "网络质量按任务、方向、协议和来源分别呈现。",
      "报告仅汇总已有检测，不发起新的探测或测速。失败探测不进入成功时延均值；不同测量方法不混算。",
    ) +
    (model.pings.length
      ? table(
          [
            "Ping 任务",
            "协议",
            "目标",
            "成功时延加权均值",
            "失败探测 / 总探测",
          ],
          pingRows,
        ) + `<div class="charts">${pingCharts}</div>`
      : note("没有可见 Ping 任务或样本；这不代表线路无丢包。")) +
    model.pings
      .map(
        (p) =>
          `<details class="chart-tables"><summary>${e(p.name)} · 探测桶数据表（${p.points.length} 点）</summary>${note("展示前 200 点；完整桶数据、样本数与失败数保存在数据 JSON。")} ${table(
            ["时间", "成功时延", "失败 / 总数"],
            p.points
              .slice(0, 200)
              .map((v) => [date(v.t), f(v.v, "ms"), `${v.lost} / ${v.sent}`]),
          )}</details>`,
      )
      .join("") +
    div +
    "<h3>既有网络检测档案</h3>" +
    (networkDetail ||
      note("所选期间没有可纳入的网络检测记录；接口状态与保留限制见数据口径。"));

  const traffic =
    summary(
      "期间流量是已观测计数器增量，套餐用量单独归档。",
      "不把当前累计值当成所选期间用量。计数器回退段不累加，边界缺样与缺测使结果可能低估。",
    ) +
    `<div class="kpis">${stat("期间已观测上传", f(model.traffic.up, "B"), "VPS 发出")}${stat("期间已观测下载", f(model.traffic.down, "B"), "VPS 接收")}${stat("当前套餐配额", model.node.trafficLimit > 0 ? f(model.node.trafficLimit, "B") : "未配置", "生成时快照")}${stat("计数器回退", String(model.traffic.resets), "回退段未纳入用量")}</div><div class="charts">${chart("net_in")}${chart("net_out")}</div>` +
    (model.traffic.daily.length
      ? '<figure><figcaption>每日已观测流量 · 蓝色 ↓ 下载 / 紫色 ↑ 上传</figcaption><div class="chart" data-chart="traffic-daily"></div></figure>' +
        table(
          ["增量归属日期", "上传", "下载"],
          model.traffic.daily.map((d) => [
            d.date,
            f(d.up, "B"),
            f(d.down, "B"),
          ]),
        )
      : note(noData)) +
    note(
      `流量质量：${model.traffic.partial ? "部分覆盖 / 仅观测增量" : "边界完整"}。跨午夜采样的增量归入后一观测点日期，不能精确拆分自然日账单。当前配额规则：${model.node.trafficRule || "未提供"}；仅为生成时配置。`,
    ) +
    model.metrics
      .filter((m) => m.key.startsWith("net_"))
      .map(chartTable)
      .join("");

  const cpu = model.stats.cpu;
  const stability =
    summary(
      "监控采集覆盖与服务在线状态分开记录。",
      "当前数据源未提供完整历史在线和重启事件；缺少样本不能直接断言节点停机。",
    ) +
    `<div class="kpis">${stat("当前状态", model.node.snapshot.online == null ? "未知" : model.node.snapshot.online ? "在线" : "离线", "生成时快照")}${stat("当前 uptime", model.node.snapshot.uptime == null ? "—" : f(model.node.snapshot.uptime / 86400, "天"), "生成时快照")}${stat("CPU 估计采集覆盖", coverage("cpu"), "按返回点间距估计")}${stat("历史在线率", "不可计算", "缺少可靠历史事件")}</div>` +
    (cpu
      ? `<h3>CPU 有效采集估计覆盖</h3><div class="coverage" role="img" aria-label="CPU 估计采集覆盖 ${e(coverage("cpu"))}"><span style="width:${Math.max(0, Math.min(100, (cpu.coveredMs / (model.range.end - model.range.start)) * 100))}%"></span></div><p class="muted">覆盖 ${e(coverage("cpu"))} · 其余为未知时间；估计依据不代表采集 SLA</p>` +
        table(
          ["未知时段开始", "结束", "时长"],
          cpu.gaps.map((g) => [
            date(g.start),
            date(g.end),
            f((g.end - g.start) / 60000, "分钟"),
          ]),
        )
      : note(noData)) +
    note(
      "重启、磁盘故障、服务异常或应用不可用需要独立事件、日志或服务级探测证明。本报告不会将资源指标自动转写为故障根因。",
    );

  const assets =
    summary(
      "保存这一刻的节点配置与资产信息。",
      "这些信息为生成时快照，无法还原所选日期内曾发生的扩容、迁移、价格或操作系统变化。",
    ) +
    definitions([
      ...model.node.fields,
      ["公网地址", model.node.ip.join(" / ") || "未提供"],
      ["内存容量", f(model.node.memory || null, "B")],
      ["磁盘容量", f(model.node.disk || null, "B")],
      ["Swap 容量", f(model.node.swap, "B")],
      ["最近上报", date(model.node.snapshot.updatedAt)],
    ]) +
    note(
      "续费配置不等于实际支出账单。不同币种不默认相加，也不自动获取汇率。历史内存与磁盘百分比若换算，只能使用当前容量分母。完整地址显示由本次生成选项决定。",
    );

  const events =
    summary(
      "每一条线索均保留规则、数值和证据入口。",
      "规则仅解释已有输入；未知时段与未采集项目不能认定为健康，也不能认定为异常。",
    ) +
    (model.findings.length
      ? `<div class="timeline">${model.findings.map((item) => `<div class="event"><time>${e(item.time != null ? date(item.time) : "本次报告的数据质量说明")}</time><strong>${e(item.title)}</strong><p>${e(item.detail)}</p><button type="button" data-jump="${e(item.chapter)}">查看对应章节 →</button></div>`).join("")}</div>`
      : note("已有数据未触发当前规则。")) +
    note(
      `规则 ${model.rules.version}：CPU >${model.rules.cpu}%，内存/磁盘 >${model.rules.memory}%。本版只标记高值返回点，不推断连续超限或瞬时峰值。`,
    );

  const previous =
    model.previous && model.previousStats
      ? "<h3>前一等长区间比较</h3>" +
        note(
          `上一期间：${date(model.previous.range.start)} — ${date(model.previous.range.end)}。覆盖不足 80%、点数不足、精度不同或查询受限时，不计算变化。`,
        ) +
        table(
          ["指标", "本期均值", "上期均值", "变化"],
          gauges.map((m) => {
            const a = model.stats[m.key],
              b = model.previousStats?.[m.key],
              prior = model.previous?.metrics.find((x) => x.key === m.key);
            const comparable =
              !!a &&
              !!b &&
              a.mean != null &&
              b.mean != null &&
              a.count > 1 &&
              b.count > 1 &&
              a.coveredMs / (model.range.end - model.range.start) >= 0.8 &&
              b.coveredMs / (model.range.end - model.range.start) >= 0.8 &&
              prior?.precision === m.precision &&
              model.sources.find((s) => s.id === "metrics")?.state ===
                "available" &&
              model.previous?.sources.find((s) => s.id === "metrics")?.state ===
                "available";
            return [
              m.label,
              f(a?.mean, m.unit),
              f(b?.mean, m.unit),
              comparable
                ? b!.mean === 0
                  ? `${f(a!.mean! - b!.mean!, m.unit)}（此前为 0）`
                  : f(((a!.mean! - b!.mean!) / Math.abs(b!.mean!)) * 100, "%")
                : "不可比",
            ];
          }),
        ) +
        table(
          [
            "Ping 任务（相同 ID）",
            "本期成功时延均值",
            "上期成功时延均值",
            "可比性",
          ],
          model.pings.map((p) => [
            p.name,
            f(model.pingStats[p.id]?.mean, "ms"),
            f(model.previousPingStats?.[p.id]?.mean, "ms"),
            "历史目标与协议配置无法完整校验，不计算增减百分比",
          ]),
        ) +
        table(
          ["上期来源", "状态", "说明"],
          model.previous.sources.map((s) => [
            s.name,
            stateLabels[s.state] || s.state,
            s.detail,
          ]),
        )
      : "";
  const sources =
    summary(
      "报告的来源、精度与缺项一并保存在本地。",
      "统计仅基于本次实际取得的输入；后端已聚合的数据不能命名为全部原始样本。",
    ) +
    definitions([
      ["报告 ID", model.reportId],
      ["生成时间", date(model.generatedAt)],
      ["后端", model.backend],
      ["显示时区", model.range.timeZone],
      [
        "原始 UTC 范围",
        `${new Date(model.range.start).toISOString()} — ${new Date(model.range.end).toISOString()}`,
      ],
      ["格式版本", "Aster report / 1"],
      ["完整地址", model.showAddresses ? "用户选择显示" : "已脱敏"],
    ]) +
    table(
      ["来源", "状态", "说明"],
      model.sources.map((s) => [
        s.name,
        stateLabels[s.state] || s.state,
        s.detail,
      ]),
    ) +
    table(
      ["指标", "有效点", "估计覆盖", "实际首尾观测", "精度 / 缺项"],
      METRIC_FIELDS.map(([key, label]) => {
        const m = metric(key),
          valid = m?.points.filter((p) => p.v != null) ?? [];
        return [
          label,
          model.stats[key]?.count ?? 0,
          coverage(key),
          valid.length
            ? `${date(valid[0]?.t)} — ${date(valid.at(-1)?.t)}`
            : "—",
          m?.precision ??
            "此范围没有返回有效值；未采集、过期或后端未提供的具体原因未知",
        ];
      }),
    ) +
    note(
      "资源按返回点间距推断时间权重，超过一份推断间距即标记未知；只有一个点时只能使用采样均值。分位数是返回点/桶均值 P95，不能还原原始样本 P95。Ping 按成功探测样本加权，丢包按总失败数/总样本数计算。任务间不合并。",
    ) +
    previous +
    note(
      "未提供的项目：历史在线/重启事件、硬盘健康、磁盘 IO/IOPS、每进程资源、容器、应用日志、漏洞与安全扫描。这份报告不声称已审计这些方面。完整返回输入与派生统计已封装在数据 JSON 中。",
    );

  const contents = [
    overview,
    resources,
    network,
    traffic,
    stability,
    assets,
    events,
    sources,
  ];
  const history =
    model.metrics.length ||
    model.network.length ||
    model.pings.some((p) => p.points.length);
  const limited =
    model.sources.some((s) =>
      ["failed", "forbidden", "partial"].includes(s.state),
    ) ||
    (cpu && cpu.gaps.length > 0);
  const payload = safeJson(model);
  const html = `<!doctype html><html lang="zh-CN" data-theme="${model.theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>${e(model.node.name)} · VPS 全面报告 · Aster</title><style>${reportCss}</style></head><body><header class="masthead"><div><div class="kicker">Aster · VPS Comprehensive Report</div><div class="title-line"><h1>${e(model.node.name)}</h1><span class="tag${limited || !history ? " warning" : ""}">${history ? (limited ? "已生成 · 部分覆盖" : "已生成 · 详见数据覆盖") : "无历史数据 · 仅配置快照"}</span></div><p class="period">${e(date(model.range.start))} — ${e(date(model.range.end))}<br>${e(model.range.timeZone)} · 生成于 ${e(date(model.generatedAt))}</p></div><div class="toolbar"><button type="button" data-print>打印 / 存为 PDF</button><button type="button" data-json>数据 JSON</button></div></header><div class="workspace"><nav aria-label="报告章节">${CHAPTERS.map(([key, name], i) => `<button type="button" data-chapter="${key}"${i === 0 ? ' aria-current="page"' : ""}><small>${String(i + 1).padStart(2, "0")}</small>${name}</button>`).join("")}<div class="nav-foot">独立快照 · 断网可读<br>${e(model.showAddresses ? "完整地址已包含" : "地址已脱敏")}<br>${e(model.reportId)}</div></nav><article class="paper">${CHAPTERS.map(([key, name], i) => `<section id="${key}" class="chapter"${i ? " hidden" : ""}><header class="chapter-head"><div><h2>${name}</h2><p>${e(model.node.name)} · 所选日期范围的已授权数据</p></div><span class="page-number">${String(i + 1).padStart(2, "0")} / 08</span></header><div class="chapter-body">${contents[i]}</div></section>`).join("")}<footer class="footer"><span>Aster · VPS 全面报告 · 格式版本 1</span><span>${e(model.node.name)} · ${e(date(model.generatedAt))}</span></footer></article></div><script id="report-data" type="application/json">${payload}</script><script>(${readerRuntime.toString()})();</script></body></html>`;
  if (new TextEncoder().encode(html).byteLength > 20 * 1024 * 1024)
    throw new Error("完整报告文件超过 20 MiB，请缩小日期范围后重新生成。");
  return html;
}

export function reportFilename(model: ReportModel, extension: "html" | "json") {
  const clean =
    model.node.name.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "-").slice(0, 60) ||
    "VPS";
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: model.range.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const stamp = (t: number) => formatter.format(t).replace(/[^\d]/g, "");
  return `Aster-${clean}-${stamp(model.range.start)}_${stamp(model.range.end)}-${model.reportId.slice(0, 8)}.${extension}`;
}
