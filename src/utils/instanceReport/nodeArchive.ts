import type { ReportFullResult } from "./model";

const titles: Record<string, string> = { header_info: "报告信息", basic_info: "基本信息", hardware_quality: "硬件质量", ip_quality: "IP 质量", net_quality: "网络质量", backroute_trace: "回程路由", yabs: "基本信息" };

/** Read only the report reader's fixed ANSI log files; never substitute JSON. */
export async function readNodeQualityArchive(base64: string): Promise<NonNullable<ReportFullResult["originalSections"]>> {
  if (base64.length > 16 * 1024 * 1024) throw new Error("NodeQuality 原始归档过大");
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(base64.replace(/\s/g, "")), c => c.charCodeAt(0)); } catch { throw new Error("NodeQuality 原始归档编码无效"); }
  const view = new DataView(bytes.buffer), decoder = new TextDecoder();
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error("NodeQuality 原始 ZIP 格式无效");
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
  if (count > 32 || start + size > end) throw new Error("NodeQuality 原始 ZIP 目录无效");
  const sections: NonNullable<ReportFullResult["originalSections"]> = [], seen = new Set<string>(); let at = start, total = 0;
  const crc = (data: Uint8Array) => { let c = 0xffffffff; for (const b of data) { c ^= b; for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; } return (c ^ 0xffffffff) >>> 0; };
  for (let i = 0; i < count; i++) {
    if (at + 46 > start + size || view.getUint32(at, true) !== 0x02014b50) throw new Error("NodeQuality ZIP 目录损坏");
    const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true), checksum = view.getUint32(at + 16, true), compressed = view.getUint32(at + 20, true), expanded = view.getUint32(at + 24, true);
    const length = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true), offset = view.getUint32(at + 42, true);
    const next = at + 46 + length + extra + comment;
    if (next > start + size) throw new Error("NodeQuality ZIP 文件名损坏");
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + length)); at = next;
    if (!/^(?:header_info|basic_info|hardware_quality|ip_quality|net_quality|backroute_trace|yabs)\.log$/.test(name)) continue;
    total += expanded;
    if (seen.has(name) || flags & 1 || ![0, 8].includes(method) || expanded > 2 * 1024 * 1024 || total > 8 * 1024 * 1024 || offset + 30 > start || view.getUint32(offset, true) !== 0x04034b50) throw new Error("NodeQuality ZIP 包含重复、不支持或过大的日志");
    seen.add(name);
    const body = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    if (body + compressed > start || view.getUint16(offset + 8, true) !== method) throw new Error("NodeQuality ZIP 日志范围无效");
    const packed = bytes.slice(body, body + compressed);
    let data: Uint8Array = packed;
    if (method === 8) {
      const reader = new Blob([packed.buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
      const parts: Uint8Array[] = []; let read = 0;
      try { while (true) { const part = await reader.read(); if (part.done) break; read += part.value.length; if (read > expanded) throw new Error("NodeQuality 日志解压超过声明大小"); parts.push(part.value); } }
      finally { await reader.cancel(); }
      data = new Uint8Array(read); let position = 0; for (const part of parts) { data.set(part, position); position += part.length; }
    }
    if (data.length !== expanded || crc(data) !== checksum) throw new Error("NodeQuality 原始日志 CRC 校验失败");
    const text = decoder.decode(data).trim().replace(/((?:password|passwd|secret|api[_-]?key|(?:access[_-]?)?token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[已隐藏]").replace(/(Authorization\s*:\s*)(?:Bearer\s+)?[^\r\n]+/gi, "$1[已隐藏]");
    const visible = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").trimStart();
    if (text && !/^[\[{]/.test(visible)) sections.push({ name, title: titles[name.slice(0, -4)] || name, format: "terminal", text });
  }
  if (!sections.length) throw new Error("上游归档未包含可显示的原始终端报告，不能用 JSON 代替原始版。");
  return sections;
}
