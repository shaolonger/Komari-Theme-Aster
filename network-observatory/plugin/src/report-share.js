// Static, script-free share report. Treat every measured string as untrusted.
function escape(value) {
  return String(value ?? "—").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
const number = (v) =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(1) : "—";
function html(round, expiresAt, jsonUrl) {
  const sections = round.slots
    .map((slot) => {
      const result = round.measurements.find((r) => r.slotId === slot.id),
        data = result?.data || {};
      let content = "";
      if (data.tcpQuality) {
        const q = data.tcpQuality;
        content =
          `<b>${number(q.medianMs)} ms</b><div class="samples">` +
          Array.from({ length: 10 }, (_, i) => {
            const sample = q.samples?.find((s) => s.index === i + 1),
              rtt = sample?.rttMs;
            return `<i title="${escape(sample ? sample.state + " · " + number(rtt) + " ms" : "未采样")}" style="background:${!sample ? "#d3dae0" : sample.state !== "ok" ? "#dc4949" : rtt < 80 ? "#25ab71" : rtt < 150 ? "#97c948" : rtt < 250 ? "#e4cc43" : "#ec9740"}"></i>`;
          }).join("") +
          `</div><p>建连失败 ${q.sent - q.received}/${q.sent} · ${escape(q.address)}</p>`;
      }
      if (data.hops)
        content =
          `<div class="scroll"><table><tr><th>TTL</th><th>IP / ASN / 网络</th><th>探测未响应%</th><th>Last</th><th>Avg</th><th>Best</th><th>Worst</th></tr>` +
          data.hops
            .map(
              (h) =>
                `<tr><td>${escape(h.ttl)}</td><td>${escape(h.address)} / AS${escape(h.asn)}<small>${escape(h.network)}</small></td><td>${number(h.lossPercent)}</td><td>${number(h.lastMs)}</td><td>${number(h.avgMs)}</td><td>${number(h.bestMs)}</td><td>${number(h.worstMs)}</td></tr>`,
            )
            .join("") +
          `</table></div><p>中间跳点未响应不等于业务丢包；终点确认到达：${data.complete ? "是" : "否"}</p>`;
      if (data.runs)
        content = data.runs
          .map(
            (r) =>
              `<p><b>${r.vpsDirection === "upload" ? "上行 · 流出 VPS" : "下行 · 流入 VPS"} / P${escape(r.streams)}</b> · ${escape(r.state)} · 平均 ${number(typeof r.bitsPerSecond === "number" ? r.bitsPerSecond / 1e6 : null)} Mbps · 最大完整一秒 ${number(typeof r.maxBitsPerSecond === "number" ? r.maxBitsPerSecond / 1e6 : null)} Mbps · TCP RTT ${number(r.tcpRttMs)} ms · 重传 ${escape(r.retransmits)}</p><div class="samples">` +
              (r.intervals || [])
                .map(
                  (i) =>
                    `<i title="${number(i.bitsPerSecond / 1e6)} Mbps" style="height:${Math.max(1, Math.min(36, (i.bitsPerSecond / Math.max(1, ...r.intervals.map((v) => v.bitsPerSecond))) * 36))}px;background:#25ab71"></i>`,
                )
                .join("") +
              `</div><small>${escape(r.diagnostic)}</small>`,
          )
          .join("");
      if (data.prefix)
        content =
          `<p>${escape(data.prefix)} · Origin ${escape(data.originAsns?.join(", "))}</p><p>BGP 是控制平面观测；AS 邻接不能证明商业转接关系。</p><details><summary>${data.paths?.length || 0} 条采集路径</summary>` +
          (data.paths || [])
            .map(
              (p) =>
                `<p>${escape(p.source)} / ${escape(p.collector)} / ${escape(p.peer)}：${escape(p.path.join(" → "))}</p>`,
            )
            .join("") +
          `</details>`;
      return `<article><h2>${escape(slot.endpoint?.name || [slot.source.city, slot.source.carrier].filter(Boolean).join(" ") || slot.target || slot.id)}</h2><small>${escape(slot.direction)} · ${escape(slot.source.provider)} · ${escape(data.method)} · ${escape(slot.state)}</small>${content}<p>${escape(data.diagnostic || slot.missingReason)}</p><details><summary>原始数据与条件</summary><pre>${escape(JSON.stringify(result || slot, null, 2))}</pre></details></article>`;
    })
    .join("");
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aster 网络报告</title><style>body{font:14px system-ui;margin:0;background:#ecf4f5;color:#283741}main{max-width:1100px;margin:32px auto;padding:16px}header,article{background:white;border:1px solid #d8e2e6;border-radius:14px;padding:22px;margin-bottom:16px}h1{font-size:24px}h2{font-size:16px}small{display:block;color:#647580}.samples{display:flex;gap:3px;align-items:end;min-height:24px;margin:16px 0}.samples i{flex:1;max-width:32px;height:22px;border-radius:2px}.scroll{overflow:auto}table{width:100%;border-collapse:collapse;white-space:nowrap}td,th{padding:10px;text-align:left;border-bottom:1px solid #e5ebef}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}a{color:#00848d}@media(prefers-color-scheme:dark){body{background:#142127;color:#d9e5e8}header,article{background:#1e2e36;border-color:#3a4d58}small{color:#b0c1c8}}@media print{details,a{display:none}article{break-inside:avoid}}</style><main><header><h1>Aster · ${escape(round.module)}</h1><p>${escape(round.plannedAt)} · ${escape(round.state)} · ${round.counts.completed}/${round.counts.expected} 项收尾</p><small>本轮报告包括公开目标与路由 IP。分享到期 ${escape(new Date(expiresAt).toISOString())}。TCP 建连失败不是 ICMP 丢包；缺测保留为空。</small><p><a href="${escape(jsonUrl)}" download="Aster-report.json">下载完整 JSON</a> · 可使用浏览器打印保存 PDF</p></header>${sections}</main></html>`;
}
module.exports = { html, escape };
