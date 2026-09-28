const fs = require("fs");
const path = require("path");

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_HISTORY_LIMIT = 20;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECTION = /^(ipv4|ipv6|intl)$/;

function imagePath(storageDir, nodeUuid, taskId, section) {
  if (!TASK_ID.test(taskId) || !SECTION.test(section)) throw new Error("报告图片标识无效");
  return path.join(storageDir, "reports", nodeUuid, `${taskId}-${section}.png`);
}

function reportId(output) {
  const match = /https:\/\/tcpquality\.ibsgss\.uk\/r\/([A-Za-z0-9_-]{6,40})(?![A-Za-z0-9_-])/.exec(output);
  return match?.[1] || "";
}

async function fetchPng(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { redirect: "error", signal: controller.signal });
    if (!response.ok || !String(response.headers.get("content-type") || "").toLowerCase().startsWith("image/png")) return null;
    if (Number(response.headers.get("content-length") || 0) > MAX_IMAGE_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < PNG_SIGNATURE.length || bytes.length > MAX_IMAGE_BYTES || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
    return bytes;
  } finally { clearTimeout(timeout); }
}

async function cacheReportImages(storageDir, record) {
  if (!["tcpquality-report", "tcpquality-intl-report"].includes(record.mode) || record.status !== "success" || !TASK_ID.test(record.taskId || "")) return;
  const id = reportId(record.rawOutput);
  if (!id) return;
  const sections = record.mode === "tcpquality-intl-report" ? ["intl"] : ["ipv4", "ipv6"];
  const images = [];
  for (const section of sections) {
    try {
      const bytes = await fetchPng(`https://tcpquality.ibsgss.uk/r/${id}.png?section=${section}&format=png`);
      if (!bytes) continue;
      const file = imagePath(storageDir, record.nodeUuid, record.taskId, section);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, bytes, { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
      images.push(section);
    } catch (error) {
      console.error(`Aster report image ${section} download failed: ${String(error?.message || error)}`);
    }
  }
  if (images.length) record.reportImages = images;
}

function pruneReportImages(storageDir, nodeUuid, rows) {
  const retained = new Set();
  let reports = 0;
  for (const row of rows.slice().reverse()) {
    if (!Array.isArray(row.reportImages) || !row.reportImages.length) continue;
    if (++reports > IMAGE_HISTORY_LIMIT) { delete row.reportImages; continue; }
    for (const section of row.reportImages) retained.add(`${row.taskId}-${section}.png`);
  }
  const directory = path.join(storageDir, "reports", nodeUuid);
  if (!fs.existsSync(directory)) return retained;
  for (const file of fs.readdirSync(directory)) {
    if (/^[0-9a-f-]{36}-(ipv4|ipv6|intl)\.png$/i.test(file) && !retained.has(file)) fs.unlinkSync(path.join(directory, file));
  }
  return retained;
}

module.exports = { cacheReportImages, imagePath, pruneReportImages, reportId };
