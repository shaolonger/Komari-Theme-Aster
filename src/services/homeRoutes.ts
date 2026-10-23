import { fetchWithTimeout } from "@/utils/abort";
import { z } from "zod";
const evidence = z.object({
  label: z.string().max(512),
  displayLabel: z.string().max(100).optional(),
  pathKind: z.enum(["single", "combined", "varied", "unknown"]).optional(),
  asns: z.array(z.string()).max(64),
  at: z.string().datetime(),
  reportId: z.string().default(""),
  diagnostic: z.string().default(""),
  samples: z.number().int().nonnegative(),
  confirmed: z.number().int().nonnegative().optional(),
  observed: z.number().int().nonnegative().optional(),
  variants: z.number().int().nonnegative().optional(),
  observations: z.array(z.unknown()).max(12).default([]),
  state: z.enum(["ok", "partial", "missing", "stale"]),
});
const row = z.object({
  carrier: z.enum(["电信", "联通", "移动"]),
  forward: evidence.nullable(),
  return: evidence.nullable(),
});
export const homeRoutesSchema = z.object({
  available: z.boolean(),
  access: z.enum(["admin", "public"]).default("public"),
  published: z.array(z.string()).default([]),
  display: z.boolean().default(true),
  nodes: z.record(
    z.object({ "4": z.array(row).max(3), "6": z.array(row).max(3) }),
  ),
});
export type RouteEvidence = z.infer<typeof evidence>;
export type HomeRoutes = z.infer<typeof homeRoutesSchema>;
export async function getHomeRoutes(
  { signal }: { signal: AbortSignal },
  admin = false,
): Promise<HomeRoutes> {
  const response = await fetchWithTimeout(
    "/api/aster-network-observatory/v3/" +
      (admin ? "home-routes" : "public/routes"),
    { credentials: "same-origin" },
    10_000,
    signal,
  );
  // Theme remains usable without the optional plugin or on an older plugin.
  if ([404, 401, 403].includes(response.status))
    return {
      available: false,
      nodes: {},
      access: admin ? "admin" : "public",
      published: [],
      display: true,
    };
  if (!response.ok) throw new Error("线路摘要暂不可用");
  const body: unknown = await response.json().catch(() => null);
  const parsed = homeRoutesSchema.safeParse(body);
  if (!parsed.success) {
    if (response.headers.get("content-type")?.includes("text/html"))
      return {
        available: false,
        nodes: {},
        access: admin ? "admin" : "public",
        published: [],
        display: true,
      };
    throw new Error("线路摘要格式不兼容，请更新网络观测插件");
  }
  return parsed.data;
}
