import { z } from "zod";
import { fetchWithTimeout } from "@/utils/abort";
export const speedValueSchema = z.object({
  bitsPerSecond: z.number().finite().nonnegative().nullable(),
  state: z.enum(["ok", "partial", "missing", "failed", "cancelled"]),
  basis: z.enum(["receiver", "tcp-acked", "estimated", "unspecified", "unavailable"]),
});
const row = z.object({ carrier: z.enum(["电信", "联通", "移动"]), at: z.string().datetime().nullable(),
  provider: z.string().max(80), download: speedValueSchema, upload: speedValueSchema });
export const homeSpeedNodeSchema = z.object({ reportId: z.string(), plannedAt: z.string().datetime(),
  at: z.string().datetime(), family: z.enum(["4", "6"]), state: z.string(), stale: z.boolean().default(false),
  cities: z.array(z.object({ city: z.enum(["北京", "上海", "广州"]), rows: z.array(row).max(3) })).max(3) });
export const homeSpeedsSchema = z.object({ available: z.boolean(), access: z.enum(["admin", "public"]),
  published: z.array(z.string()), display: z.boolean(), nodes: z.record(homeSpeedNodeSchema) });
export type HomeSpeeds = z.infer<typeof homeSpeedsSchema>;
export type HomeSpeedNode = z.infer<typeof homeSpeedNodeSchema>;
export type SpeedValue = z.infer<typeof speedValueSchema>;
export async function getHomeSpeeds({ signal }: { signal: AbortSignal }, admin = false): Promise<HomeSpeeds> {
  const fallback: HomeSpeeds = { available: false, nodes: {}, access: admin ? "admin" : "public", published: [], display: true };
  const response = await fetchWithTimeout("/api/aster-network-observatory/v3/" + (admin ? "home-speeds" : "public/speeds"), { credentials: "same-origin" }, 10_000, signal);
  if ([401, 403, 404].includes(response.status)) return fallback;
  if (!response.ok) throw new Error("测速摘要暂不可用");
  if (response.headers.get("content-type")?.includes("text/html")) return fallback;
  const parsed = homeSpeedsSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("测速摘要格式不兼容，请更新网络观测插件");
  return parsed.data;
}
