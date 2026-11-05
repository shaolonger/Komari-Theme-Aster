export interface OriginalReportPage { title: string; svg: string }
import { readNodeQualityArchive } from "@/utils/instanceReport/nodeArchive";
import type { ReportFullResult } from "@/utils/instanceReport/model";
export interface OriginalReportAssets { pages?: OriginalReportPage[]; sections?: ReportFullResult["originalSections"] }

const upgradeMessage = "网络观测插件尚未提供原始图片接口，请更新插件至 1.22.0 或更新版本并重新启用，然后重试。原报告链接仍可正常查看。";

export async function loadReportOriginalImages(nodeUuid: string, roundId: string, signal: AbortSignal): Promise<OriginalReportAssets> {
  const response = await fetch(`/api/aster-network-observatory/v3/nodes/${encodeURIComponent(nodeUuid)}/rounds/${encodeURIComponent(roundId)}/original-images`, {
    credentials: "same-origin", headers: { Accept: "application/json" }, signal,
  });
  // Older plugin versions fall through to Komari's HTML app with HTTP 200.
  const type = response.headers.get("content-type") || "";
  if (/text\/html/i.test(type)) throw new Error(upgradeMessage);
  let data: { pages?: unknown; nodeArchive?: unknown; error?: string };
  try { data = await response.json(); }
  catch { throw new Error(response.status === 404 ? upgradeMessage : "原始图片接口未返回有效 JSON，请检查插件是否已正确启用。"); }
  if (!response.ok) throw new Error(data?.error || (response.status === 404 ? upgradeMessage : `原始图片读取失败（HTTP ${response.status}）。`));
  if (typeof data?.nodeArchive === "string") return { sections: await readNodeQualityArchive(data.nodeArchive) };
  if (!data || typeof data !== "object" || !Array.isArray(data.pages) || !data.pages.length || data.pages.length > 12) throw new Error("原始图片接口未返回报告分区，请确认网络观测插件已更新并重新启用。");
  let size = 0;
  const pages = data.pages.map((page: { title?: unknown; svg?: unknown }) => {
    if (!page || typeof page.svg !== "string" || !page.svg.trim() || page.svg.length > 2 * 1024 * 1024 || !/<svg\b/i.test(page.svg)) throw new Error("原始图片分区格式或尺寸无效。");
    size += page.svg.length;
    return { title: typeof page.title === "string" ? page.title.slice(0, 80) : "原报告", svg: page.svg };
  });
  if (size > 8 * 1024 * 1024) throw new Error("本轮原始图片超过 8 MiB，请直接查看上游原报告。");
  return { pages };
}
