import type { ReportRound } from "@/services/reportObservatory";
export function exportReportPng(round: ReportRound) {
  // Data-rendered summary: the full evidence remains in the accompanying JSON.
  const canvas = document.createElement("canvas"),
    width = 1440,
    columns = 3,
    rows = Math.ceil(round.slots.length / columns);
  canvas.width = width;
  canvas.height = 220 + rows * 90;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器无法创建 PNG 画布");
  ctx.fillStyle = "#edf4f5";
  ctx.fillRect(0, 0, width, canvas.height);
  ctx.font = "bold 32px system-ui";
  ctx.fillStyle = "#243c46";
  ctx.fillText("Aster · " + round.module + " · 本轮汇总", 36, 56);
  ctx.font = "18px system-ui";
  ctx.fillText(
    round.plannedAt +
      " · " +
      round.state +
      " · " +
      round.counts.completed +
      "/" +
      round.counts.expected +
      " 项",
    36,
    94,
  );
  ctx.fillText(
    "TCP 建连中位数 / 接收端平均速率；缺测不补零。完整逐跳、区间和来源见 JSON。",
    36,
    128,
  );
  for (let index = 0; index < round.slots.length; index++) {
    const slot = round.slots[index],
      result = round.measurements.find((r) => r.slotId === slot.id),
      x = 36 + (index % columns) * 462,
      y = 164 + Math.floor(index / columns) * 90;
    ctx.fillStyle = "#fff";
    ctx.fillRect(x, y, 448, 78);
    ctx.fillStyle = "#243c46";
    ctx.font = "bold 16px system-ui";
    ctx.fillText(
      (
        slot.endpoint?.name ||
        [slot.source.city, slot.source.carrier].filter(Boolean).join(" ") ||
        slot.target ||
        slot.id
      ).slice(0, 40),
      x + 12,
      y + 24,
    );
    ctx.font = "14px system-ui";
    const q = result?.data.tcpQuality;
    let text = q
      ? `${q.medianMs?.toFixed(1) ?? "—"} ms · 建连失败 ${q.sent - q.received}/${q.sent}`
      : result?.data.runs
        ? result.data.runs
            .map(
              (r) =>
                `${r.vpsDirection === "upload" ? "↑" : "↓"}P${r.streams} ${r.bitsPerSecond == null ? "—" : (r.bitsPerSecond / 1e6).toFixed(1)} Mbps`,
            )
            .join(" / ")
        : result?.data.hops
          ? `${slot.direction} · ${result.data.hops.length} 跳 · ${result.data.complete ? "到达" : "未确认终点"}`
          : slot.state;
    if (!round.detailAvailable) text = "明细已过期 · " + slot.state;
    ctx.fillText(text.slice(0, 65), x + 12, y + 50);
    ctx.font = "11px system-ui";
    ctx.fillStyle = "#667980";
    ctx.fillText(
      (result?.data.diagnostic || slot.missingReason || slot.target).slice(
        0,
        72,
      ),
      x + 12,
      y + 68,
    );
  }
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `Aster-${round.module}-${round.id}-summary.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}
