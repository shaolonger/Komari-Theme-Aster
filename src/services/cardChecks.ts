import { z } from "zod";
import { fetchWithTimeout } from "@/utils/abort";

export type CardCheckModule = "routes" | "china-speed";
const counts = z.object({ expected: z.number().int().nonnegative(), completed: z.number().int().nonnegative(),
  ok: z.number().int().nonnegative(), partial: z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(), cancelled: z.number().int().nonnegative() });
export const cardProgressSchema = z.object({ nodeUuid: z.string(), id: z.string(), module: z.enum(["routes", "china-speed"]).optional(),
  family: z.enum(["4", "6"]).optional(), phase: z.enum(["queued", "running", "finished", "unavailable"]), state: z.string(),
  counts, waitReason: z.string().default(""), suiteName: z.string().default("检测方案"), completedAt: z.string().nullable().optional() });
export type CardProgress = z.infer<typeof cardProgressSchema>;
export const cardCheckKey = (uuid: string, module: CardCheckModule, family: "4" | "6") => `${uuid}:${module}:${family}`;
export const isCheckFinished = (progress?: CardProgress) => progress?.phase === "finished" || progress?.phase === "unavailable";
export function cardCheckPercent(progress?: CardProgress) {
  if (isCheckFinished(progress)) return 100;
  return progress?.counts.expected ? Math.min(99, Math.floor(progress.counts.completed / progress.counts.expected * 100)) : 0;
}
async function request(path: string, body: unknown, signal?: AbortSignal) {
  const response = await fetchWithTimeout("/api/aster-network-observatory/v3" + path,
    { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, 12_000, signal);
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(response.status === 404 ? "请更新网络观测插件以使用卡片检测" :
    value && typeof value === "object" && "error" in value ? String(value.error) : "检测请求暂不可用");
  return value;
}
export async function startCardCheck(uuid: string, module: CardCheckModule, family: "4" | "6") {
  const result = cardProgressSchema.safeParse(await request(`/nodes/${encodeURIComponent(uuid)}/card-check`, { module, family }));
  if (!result.success) throw new Error("检测接口格式不兼容，请更新网络观测插件");
  return result.data;
}
export async function getCardChecks(checks: { nodeUuid: string; id: string }[], signal: AbortSignal) {
  const chunks = Array.from({ length: Math.ceil(checks.length / 64) }, (_, i) => checks.slice(i * 64, i * 64 + 64));
  return (await Promise.all(chunks.map(async chunk => z.object({ checks: z.array(cardProgressSchema) }).parse(
    await request("/card-checks/progress", { checks: chunk }, signal)).checks))).flat();
}
