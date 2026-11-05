// Fetch only a stored TcpQuality report's official vector exports. Never proxy a caller URL.
function reportToken(value, module = "tcpquality-full") {
  const pattern = module === "nodequality-full" ? /^https:\/\/(?:www\.)?nodequality\.com\/r\/([A-Za-z0-9_-]{1,128})$/ : /^https:\/\/tcpquality\.ibsgss\.uk\/r\/([A-Za-z0-9_-]{1,128})$/;
  const match = pattern.exec(String(value || ""));
  return match ? match[1] : "";
}
function safeSvg(svg) {
  if (typeof svg !== "string" || svg.length > 2 * 1024 * 1024 || !/<svg\s/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) throw new Error("上游图片格式或尺寸无效");
  // Links do not affect the exported artwork; remove navigation while preserving its text.
  svg = svg.replace(/<a\b[^>]*>/gi, "<g>").replace(/<\/a>/gi, "</g>");
  if (/<(?:script|foreignObject|iframe|object|embed|image|use)\b|<!DOCTYPE|<!ENTITY|\bon[a-z]+\s*=|(?:href|src)\s*=|@import\b|url\((?!\s*['"]?(?:data:|#))/i.test(svg)) throw new Error("上游矢量图片包含不支持的外部内容");
  return svg;
}
function createReportAssets({ fetcher = (...args) => fetch(...args), timeoutMs = 25000 } = {}) {
  const pending = new Map();
  async function collect(url, module = "tcpquality-full") {
    const token = reportToken(url, module), key = module + ":" + token;
    if (!token) throw new Error("本轮未提供有效的上游原报告链接");
    if (pending.has(key)) return pending.get(key);
    const work = (async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        if (module === "nodequality-full") {
          // Same public request signature used by NodeQuality's own report reader.
          const origin = "https://api.nodequality.com", agent = "Aster-Report/1.33.0";
          const get = async (path, extra = {}) => {
            const response = await fetcher(origin + path, { signal: controller.signal, redirect: "error", headers: { accept: "application/json", "user-agent": agent, origin: "https://nodequality.com", referer: "https://nodequality.com/r/" + token, ...extra } });
            if (!response.ok) throw new Error(`NodeQuality 上游 HTTP ${response.status}，无法读取真实原报告`);
            const raw = await response.text();
            if (raw.length > 16 * 1024 * 1024) throw new Error("NodeQuality 原报告超过 16 MiB");
            try { return JSON.parse(raw); } catch { throw new Error("NodeQuality 上游未返回有效的报告数据"); }
          };
          const info = await get("/api/v1/ipinfo");
          if (typeof info.ip !== "string" || info.ip.length > 64 || !/^[a-fA-F0-9:.]+$/.test(info.ip) || !/^[0-9]{1,16}$/.test(String(info.ts))) throw new Error("NodeQuality 上游签名信息无效");
          const path = "/api/v1/record/" + token;
          const signature = require("crypto").createHash("sha1").update(["GET", origin + path, agent, info.ip + info.ts, ""].join("\n\n")).digest("hex");
          const result = await get(path, { "x-dynamic-sign-v": signature, "x-dynamic-sign-t": String(info.ts) });
          const archive = result?.data?.result;
          if (result?.success !== true || typeof archive !== "string" || !archive.length || !/^[A-Za-z0-9+/=\r\n]+$/.test(archive)) throw new Error("NodeQuality 上游未提供有效的原始报告归档");
          return { nodeArchive: archive };
        }
        const read = async suffix => {
          const response = await fetcher(`https://tcpquality.ibsgss.uk/r/${token}${suffix}`, { signal: controller.signal, redirect: "error", headers: { accept: suffix ? "image/svg+xml" : "text/html" } });
          if (!response.ok) throw new Error(`上游原报告 HTTP ${response.status}`);
          const raw = await response.text();
          if (raw.length > 4 * 1024 * 1024) throw new Error("上游原报告超过读取上限");
          return raw;
        };
        const html = await read("");
        const match = /\bconst\s+reportSections\s*=\s*(\[[^\r\n]*\]);/.exec(html);
        if (!match) throw new Error("上游尚未提供可导出的报告分区");
        const sections = JSON.parse(match[1]);
        if (!Array.isArray(sections) || !sections.length || sections.length > 12) throw new Error("上游报告分区数量无效");
        const pages = []; let bytes = 0;
        for (const section of sections) {
          if (!/^[a-z0-9_-]{1,32}$/.test(section.id || "")) throw new Error("上游分区标识无效");
          const svg = safeSvg(await read(`.svg?section=${section.id}`));
          bytes += svg.length;
          if (bytes > 8 * 1024 * 1024) throw new Error("本轮原始图片超过 8 MiB");
          pages.push({ title: String(section.label || section.id).slice(0, 80), svg });
        }
        return { pages };
      } finally { clearTimeout(timer); }
    })();
    pending.set(key, work);
    try { return await work; } finally { pending.delete(key); }
  }
  return { collect };
}
module.exports = { createReportAssets, reportToken, safeSvg };
