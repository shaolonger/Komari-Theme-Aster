import type { ReportFullResult } from "./model";

/** Embedded verbatim in offline reports; all helpers intentionally live inside. */
export function resultToolkit(TerminalConstructor?: typeof import("@xterm/xterm").Terminal) {
  const xmlText = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/gu, "");
  const escape = (value: unknown) => xmlText(String(value ?? "")).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  // OSC titles/hyperlinks and other terminal commands are not printable XML.
  const terminal = (value: string, preserveCR = false) => value.replace(/(?:\x1b\]|\x9d)[\s\S]*?(?:\x07|\x1b\\|\x9c|$)/g, "").replace(/\x1b[PX^_][\s\S]*?(?:\x1b\\|$)/g, "").replace(/\r/g, preserveCR ? "\r" : "");
  const strip = (value: string) => xmlText(terminal(value).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ""));
  const colors = ["#236bfe", "#00ad92", "#8b5cf6", "#f59e0b", "#ef5276"];
  function csv(value: string) {
    const rows: string[][] = []; let row: string[] = [], field = "", quoted = false;
    const input = value.replace(/^\uFEFF/, "");
    for (let i = 0; i < input.length; i++) {
      const c = input[i];
      if (c === '"') { if (quoted && input[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
      else if ((c === "," || c === "\n") && !quoted) { row.push(field.replace(/\r$/, "")); field = ""; if (c === "\n") { if (row.some(Boolean)) rows.push(row); row = []; } }
      else field += c;
    }
    row.push(field.replace(/\r$/, "")); if (row.some(Boolean)) rows.push(row);
    return rows;
  }
  function flatten(value: unknown, prefix = ""): [string, string][] {
    if (Array.isArray(value)) return value.flatMap((v, i) => flatten(v, `${prefix} / ${i + 1}`));
    if (value && typeof value === "object") return Object.entries(value).flatMap(([key, v]) => flatten(v, prefix ? `${prefix} / ${key}` : key));
    return [[prefix || "结果", value == null ? "未提供" : String(value)]];
  }
  const title = (result: ReportFullResult) => result.module === "tcpquality-full" ? "TcpQuality" : "NodeQuality";
  const status = (state: string) => ({ ok: "检测完成", complete: "检测完成", partial: "部分结果", failed: "检测失败", missing: "结果缺失", cancelled: "已取消", running: "检测中" })[state as "ok"] || "状态未知";
  const stamp = (result: ReportFullResult, zone: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(result.time);
  const text = (x: number, y: number, value: unknown, size = 16, color = "#18315c", weight = "400") => `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}">${escape(value)}</text>`;
  const wrap = (value: string, limit: number) => {
    const rows: string[] = []; let line = "", length = 0;
    for (const c of Array.from(value)) { const size = /[^\x00-\xff]/.test(c) ? 2 : 1; if (length + size > limit) { rows.push(line); line = ""; length = 0; } line += c; length += size; }
    if (line || !rows.length) rows.push(line); return rows;
  };
  function unified(result: ReportFullResult, node: string, zone: string) {
    const facts: { section: string; label: string; value: string }[] = [];
    const chart: { label: string; value: number; unit: string }[] = [];
    for (const section of result.sections) {
      if (section.format === "csv") {
        const [heads = [], ...rows] = csv(section.text);
        for (const row of rows) {
          const label = row.slice(0, Math.min(4, row.length)).filter(Boolean).join(" · ");
          const description = row.map((cell, i) => cell ? `${heads[i] || `字段 ${i + 1}`}：${cell}` : "").filter(Boolean).join("   ");
          for (const [i, part] of wrap(description, 112).entries()) facts.push({ section: section.title, label: i ? "" : label, value: part });
          const index = heads.findIndex(h => /(?:延迟.*ms|latency|rtt|平均.*ms)/i.test(h));
          const n = index < 0 ? NaN : Number(row[index]);
          if (row[index]?.trim() && Number.isFinite(n) && n >= 0) chart.push({ label, value: n, unit: "ms" });
        }
      } else if (section.format === "json") {
        let values: [string, string][] = [];
        try { values = flatten(JSON.parse(section.text)); } catch { values = [["原始结果", section.text]]; }
        for (const [label, value] of values) {
          for (const [i, part] of wrap(value, 83).entries()) facts.push({ section: section.title, label: i ? "" : label, value: part });
          const n = Number(value);
          if (value.trim() && Number.isFinite(n) && n >= 0 && /(?:latency|rtt|avg_ms|延迟)/i.test(label)) chart.push({ label, value: n, unit: "ms" });
        }
      } else for (const line of strip(section.text).split("\n")) for (const part of wrap(line, 112)) facts.push({ section: section.title, label: "", value: part });
    }
    const pages: string[] = [];
    const slices: typeof facts[] = [[]];
    let used = 0, previousSection = "";
    for (const fact of facts) {
      const cost = (fact.label ? 39 : 24) + (fact.section !== previousSection ? 25 : 0);
      const budget = slices.length === 1 && chart.length ? 1050 - Math.min(5, chart.length) * 30 - 53 : 1050;
      if (used + cost > budget && slices.at(-1)!.length) { slices.push([]); used = 0; previousSection = ""; }
      used += (fact.label ? 39 : 24) + (fact.section !== previousSection ? 25 : 0);
      slices.at(-1)!.push(fact); previousSection = fact.section;
    }
    const count = slices.length;
    for (let page = 0; page < count; page++) {
      let body = `<defs><linearGradient id="wash" x2="1" y2="1"><stop stop-color="#eff6ff"/><stop offset="1" stop-color="#f6f3ff"/></linearGradient></defs><rect width="1200" height="1540" fill="#f1f5fc"/><rect width="1200" height="290" fill="url(#wash)"/><circle cx="1090" cy="30" r="180" fill="#dceaff" opacity=".65"/>`;
      body += text(54, 56, "ASTER / RESULT COLLECTION", 13, "#5282c6", "700") + text(54, 108, `${title(result)} 检测结果`, 35, "#102354", "700");
      body += text(54, 143, `${node} · ${stamp(result, zone)} · ${zone}`, 16, "#6680a5");
      body += `<rect x="54" y="169" width="1092" height="92" rx="18" fill="#fff"/>`;
      const coverage = result.coverage;
      const cards = coverage ? [["检测状态", status(result.state)], ["完成项目", String(coverage.ok)], ["需留意", String(coverage.failed)], ["未完成 / 未知", String(coverage.skipped + coverage.unknown)]] : [["检测状态", status(result.state)], ["结果分区", String(result.sections.length)], ["检测配置", result.profile || "上游配置"], ["归档内容", result.truncated ? "部分保留" : "已保存内容"]];
      cards.forEach(([label, value], i) => { body += text(76 + i * 270, 199, label, 13, "#7890ad") + text(76 + i * 270, 235, value, 23, i === 0 ? colors[0] : "#18315c", "700"); });
      body += `<rect x="54" y="287" width="1092" height="1190" rx="20" fill="#fff"/>`;
      let top = 328;
      if (page === 0 && chart.length) {
        body += text(78, top, `测点延迟分布 · ${chart[0]!.unit}`, 17, "#18315c", "700"); top += 28;
        const visible = chart.slice(0, 5), max = Math.max(1, ...visible.map(row => row.value));
        visible.forEach((row, i) => { body += text(78, top + i * 30 + 15, row.label.slice(0, 24), 12, "#6680a5") + `<rect x="405" y="${top + i * 30}" width="530" height="18" rx="7" fill="#eff4fc"/><rect x="405" y="${top + i * 30}" width="${Math.max(1, row.value / max * 530)}" height="18" rx="7" fill="${colors[i % colors.length]}"/>` + text(954, top + i * 30 + 15, row.value.toFixed(2), 13); });
        top += visible.length * 30 + 25;
      }
      let lastSection = "";
      for (const fact of slices[page]!) {
        if (fact.section !== lastSection) { body += text(78, top, fact.section, 15, "#236bfe", "700"); top += 25; lastSection = fact.section; }
        const label = fact.label ? fact.label.slice(0, 40) : "";
        body += text(78, top, label, 13, "#7890ad"); if (label) top += 15;
        body += text(78, top, fact.value, 18, "#2c4568"); top += 24;
      }
      if (!facts.length) body += text(78, top + 20, "此轮未保留可导出的详细结果；请查看原报告链接或检测状态。", 17, "#7890ad");
      const height = Math.max(760, Math.min(1540, top + 105));
      body = body.replace('height="1540"', `height="${height}"`).replace('height="1190"', `height="${height - 350}"`);
      body += text(54, height - 36, result.url || "本轮未提供有效的上游报告链接", 12, "#6680a5") + text(1050, height - 36, `${page + 1} / ${count}`, 12, "#6680a5");
      pages.push(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}" font-family="system-ui,'PingFang SC','Microsoft YaHei',sans-serif">${body}</svg>`);
    }
    return pages;
  }
  async function original(result: ReportFullResult) {
    if (result.originalPages?.length) return result.originalPages.map(page => {
      const root = page.svg.match(/<svg\b[^>]*>/i)?.[0];
      if (!root) throw new Error("上游原始图片缺少 SVG 根元素");
      const box = root.match(/\bviewBox=["']([^"']+)["']/i)?.[1]?.trim().split(/[\s,]+/).map(Number);
      const dimensions = box?.length === 4 ? box : [0, 0, Number(root.match(/\bwidth=["']([\d.]+)/i)?.[1]), Number(root.match(/\bheight=["']([\d.]+)/i)?.[1])];
      if (!dimensions.every(Number.isFinite) || dimensions[2]! <= 0 || dimensions[3]! <= 0) throw new Error("上游原始图片尺寸无效");
      // One upstream section is one complete image. Never change its viewBox.
      return page.svg;
    });
    if (result.module === "tcpquality-full") throw new Error(result.originalError || "此轮尚未取得上游原始图片，请在线重新预览后导出。");
    if (!TerminalConstructor) throw new Error("原始报告终端渲染器未加载");
    const source = result.originalSections;
    if (!source?.length) throw new Error("此轮尚未取得上游真实终端报告，不能用 JSON 代替原始版。请在线重新预览。");
    const choose = (...names: string[]) => names.map(name => source.find(section => section.name === name)?.text).find(Boolean);
    const logs = [choose("header_info.log"), choose("hardware_quality.log", "basic_info.log", "yabs.log"), choose("ip_quality.log"), choose("net_quality.log"), choose("backroute_trace.log")].filter((value): value is string => Boolean(value));
    if (!logs.length || logs.some(log => /^\s*[\[{]/.test(log))) throw new Error("上游未提供可显示的原始终端日志，不能用 JSON 代替。");
    const palette = ["#050404", "#bd0013", "#4ab118", "#e7741e", "#0f4ac6", "#665993", "#70a598", "#f8dcc0", "#4e7cbf", "#fc5f5a", "#9eff6e", "#efc11a", "#1997c6", "#9b5953", "#c8faf4", "#f6f5fb"];
    const paletteColor = (n: number) => {
      if (n < 16) return palette[n]!;
      if (n >= 232) { const v = 8 + (n - 232) * 10; return `rgb(${v},${v},${v})`; }
      const value = n - 16, component = (n: number) => n === 0 ? 0 : 55 + n * 40;
      return `rgb(${component(Math.floor(value / 36))},${component(Math.floor(value / 6) % 6)},${component(value % 6)})`;
    };
    const term = new TerminalConstructor({ cols: 114, rows: 2, scrollback: 30000, convertEol: true, allowProposedApi: true });
    try {
      for (const log of logs) {
        const printable = terminal(log, true).replace(/\x1b\[(?:3;?J|H|2J)/g, "").trim() + "\r\n\r\n";
        await new Promise<void>(resolve => term.write(printable, resolve));
        if (term.buffer.active.length >= 30000) throw new Error("上游终端报告超过 30000 行，无法完整导出；请直接查看原报告。");
      }
      const buffer = term.buffer.active;
      let rows = buffer.length;
      while (rows > 1 && !buffer.getLine(rows - 1)?.translateToString(true).trim()) rows--;
      const top = 212, lineHeight = 18, cellWidth = 8.4, left = 232;
      const height = top + rows * lineHeight + 118;
      let content = `<defs><linearGradient id="node-page" x2="0" y2="1"><stop stop-color="#0d0d18"/><stop offset=".7" stop-color="#170d31"/><stop offset="1" stop-color="#412084"/></linearGradient></defs><rect width="1420" height="${height}" fill="url(#node-page)"/><rect x="210" y="148" width="1000" height="${rows * lineHeight + 91}" rx="10" fill="#ffffff" fill-opacity=".1"/><path d="M554 36v46" stroke="#37ff8b" stroke-width="6"/>`;
      content += text(566, 73, "NodeQuality", 46, "#fff", "600").replace("font-size=", 'font-family="Arial,sans-serif" font-size=');
      const actions = (y: number) => ["复制文本", "复制为NodeSeek格式", "复制为通用Markdown", "提交"].map((label, i) => {
        const widths = [88, 154, 154, 62], x = 210 + widths.slice(0, i).reduce((n, w) => n + w + 7, 0);
        return `<rect x="${x}" y="${y}" width="${widths[i]}" height="27" fill="none" stroke="${i === 3 ? "#37ff8b" : "#777"}"/>` + text(x + 11, y + 18, label, 12, i === 3 ? "#37ff8b" : "#aaa");
      }).join("");
      content += actions(112) + `<rect x="231" y="158" width="500" height="34" rx="7" fill="#111" fill-opacity=".5"/><rect x="237" y="163" width="81" height="24" rx="6" fill="#888" fill-opacity=".4"/>`;
      ["全部", "基本信息", "IP质量", "网络质量", "回程路由"].forEach((label, i) => { content += text(266 + i * 97, 181, label, 12, "#00ef80", "700"); });
      for (let row = 0; row < rows; row++) {
        const line = buffer.getLine(row); if (!line) continue;
        let run = "", runStart = 0, runWidth = 0, prior = "", fg = "", bg = "", weight = "", decoration = "", opacity = "1", italic = "normal";
        const flush = () => {
          if (!run) return;
          const x = left + runStart * cellWidth, y = top + row * lineHeight;
          if (bg) content += `<rect x="${x}" y="${y - 14}" width="${runWidth * cellWidth}" height="18" fill="${bg}"/>`;
          if (run.trim()) content += `<text x="${x}" y="${y}" fill="${fg}" font-size="14" font-weight="${weight}" font-style="${italic}" opacity="${opacity}" text-decoration="${decoration}" xml:space="preserve" textLength="${runWidth * cellWidth}" lengthAdjust="spacingAndGlyphs">${escape(run)}</text>`;
          run = ""; runWidth = 0;
        };
        for (let column = 0; column < term.cols; column++) {
          const cell = line.getCell(column); if (!cell || !cell.getWidth()) continue;
          let foreground = cell.isFgRGB() ? `#${cell.getFgColor().toString(16).padStart(6, "0")}` : cell.isFgPalette() ? paletteColor(cell.getFgColor() + (cell.isBold() && cell.getFgColor() < 8 ? 8 : 0)) : "#f8dcc0";
          let background = cell.isBgRGB() ? `#${cell.getBgColor().toString(16).padStart(6, "0")}` : cell.isBgPalette() ? paletteColor(cell.getBgColor()) : "";
          if (cell.isInverse()) [foreground, background] = [background || "#22212c", foreground];
          const next = [foreground, background, cell.isBold() ? "700" : "400", cell.isUnderline() ? "underline" : cell.isStrikethrough() ? "line-through" : "none", cell.isDim() ? ".5" : "1", cell.isItalic() ? "italic" : "normal"];
          const key = next.join("|");
          if (key !== prior) { flush(); [fg, bg, weight, decoration, opacity, italic] = next as [string, string, string, string, string, string]; runStart = column; prior = key; }
          if (!run) runStart = column;
          run += cell.isInvisible() ? " " : cell.getChars() || " "; runWidth += cell.getWidth();
        }
        flush();
      }
      content += actions(height - 57) + text(1038, height - 16, "Powered By NodeSeek", 12, "#c5c5dc");
      return [`<svg xmlns="http://www.w3.org/2000/svg" width="1420" height="${height}" viewBox="0 0 1420 ${height}" font-family="Consolas,'Courier New',monospace">${content}</svg>`];
    } finally { term.dispose(); }
  }
  async function png(svg: string, scale = 2) {
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    if (parsed.querySelector("parsererror") || parsed.documentElement.localName !== "svg") throw new Error("结果图片包含无效的矢量内容，无法生成 PNG。");
    const image = new Image(); image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    try { await image.decode(); } catch { throw new Error("结果图片无法解码，请重新生成报告后重试。"); }
    const width = image.naturalWidth, height = image.naturalHeight;
    scale = Math.min(Math.max(scale, 2400 / width), Math.sqrt(64000000 / (width * height)), 32760 / Math.max(width, height));
    if (!width || !height || scale <= 0 || width * height * scale * scale > 64000001) throw new Error("单张原始图片尺寸过大，请使用上游分区报告。");
    const canvas = document.createElement("canvas"); canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("浏览器无法创建高清图片");
    const background = parsed.documentElement.querySelector("rect")?.getAttribute("fill") || "";
    ctx.fillStyle = /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(background) ? background : "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("PNG 编码失败")), "image/png"));
    canvas.width = canvas.height = 1;
    return blob;
  }
  function zip(files: { name: string; bytes: Uint8Array }[]) {
    const encoder = new TextEncoder(), parts: Uint8Array[] = [], entries: Uint8Array[] = [];
    const table = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[i] = c >>> 0; }
    const crc = (bytes: Uint8Array) => { let value = 0xffffffff; for (const b of bytes) value = table[(value ^ b) & 255]! ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; };
    let offset = 0, directorySize = 0;
    for (const file of files) {
      const name = encoder.encode(file.name), sum = crc(file.bytes), local = new Uint8Array(30 + name.length), view = new DataView(local.buffer);
      view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true); view.setUint32(14, sum, true); view.setUint32(18, file.bytes.length, true); view.setUint32(22, file.bytes.length, true); view.setUint16(26, name.length, true); local.set(name, 30);
      const central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint32(16, sum, true); cv.setUint32(20, file.bytes.length, true); cv.setUint32(24, file.bytes.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); central.set(name, 46);
      parts.push(local, file.bytes); entries.push(central); offset += local.length + file.bytes.length; directorySize += central.length;
      if (offset + directorySize > 128 * 1024 * 1024) throw new Error("图片压缩包超过 128 MiB，请减少所选结果。");
    }
    const end = new Uint8Array(22), ev = new DataView(end.buffer); ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, directorySize, true); ev.setUint32(16, offset, true);
    const output = new Uint8Array(offset + directorySize + end.length); let at = 0; for (const part of [...parts, ...entries, end]) { output.set(part, at); at += part.length; } return output;
  }
  return { unified, original, png, zip, csv, flatten, title, status };
}
export type ResultToolkit = ReturnType<typeof resultToolkit>;
