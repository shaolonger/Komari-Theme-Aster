import { z } from "zod";
const source = z
  .object({
    provider: z.string(),
    name: z.string().optional(),
    city: z.string().optional(),
    carrier: z.string().optional(),
    asn: z.number().optional(),
    network: z.string().optional(),
    country: z.string().optional(),
    accessType: z.string().optional(),
    runnerVersion: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .passthrough();
const timing = z.union([
  z.object({ type: z.literal("interval"), minutes: z.number() }),
  z.object({
    type: z.literal("daily"),
    times: z.array(z.string()),
    timezone: z.string(),
  }),
]);
const policy = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["routes", "speed", "websites"]),
  clients: z.array(z.string()),
  groups: z.array(z.string()),
  sources: z.array(z.string()),
  sites: z.array(z.string()),
  family: z.enum(["4", "6"]),
  protocol: z.enum(["tcp", "icmp"]),
  seconds: z.number(),
  streams: z.array(z.number()),
  timing,
  publicSources: z.boolean(),
  enabled: z.boolean(),
  inherit: z.boolean(),
  trafficAccepted: z.boolean(),
  nextAt: z.number(),
});
const probe = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string(),
  carrier: z.string(),
  accessType: z.string(),
  publicAddress: z.string(),
  online: z.boolean(),
});
const job = z.object({
  id: z.string(),
  nodeUuid: z.string(),
  policyId: z.string(),
  operation: z.string(),
  direction: z.string(),
  phase: z.string(),
  target: z.string(),
  source,
});
const speed = z.object({
  direction: z.string(),
  streams: z.number(),
  state: z.string(),
  bitsPerSecond: z.number().nullable().optional(),
  bytes: z.number().nullable().optional(),
  seconds: z.number().nullable().optional(),
  retransmits: z.number().nullable().optional(),
  remoteIp: z.string().optional(),
  diagnostic: z.string().optional(),
});
export const record = z.object({
  id: z.string(),
  nodeUuid: z.string(),
  policyId: z.string(),
  completedAt: z.string(),
  operation: z.string(),
  target: z.string(),
  direction: z.string(),
  pairId: z.string(),
  fingerprint: z.string(),
  source,
  options: z.record(z.unknown()),
  data: z
    .object({
      kind: z.string(),
      state: z.string(),
      diagnostic: z.string().optional(),
      httpStatus: z.number().optional(),
      resolvedIp: z.string().optional(),
      errorStage: z.string().optional(),
      timingsMs: z
        .object({
          dns: z.number(),
          connect: z.number(),
          tls: z.number(),
          ttfb: z.number(),
          total: z.number(),
        })
        .optional(),
      tlsVerified: z.boolean().optional(),
      path: z.string().optional(),
      tcpQuality: z
        .object({
          method: z.string(),
          state: z.string(),
          address: z.string(),
          addressScope: z.string().optional(),
          sent: z.number(),
          received: z.number(),
          failurePercent: z.number().nullable(),
          avgMs: z.number().nullable(),
          minMs: z.number().nullable(),
          maxMs: z.number().nullable(),
          stdevMs: z.number().nullable(),
        })
        .nullable()
        .optional(),
      complete: z.boolean().optional(),
      method: z.string().optional(),
      protocol: z.string().optional(),
      hops: z
        .array(
          z.object({
            ttl: z.number(),
            address: z.string(),
            asn: z.string(),
            asnStatus: z.string().optional(),
            asnSource: z.string().optional(),
            asnQueriedAt: z.string().optional(),
            network: z.string().optional(),
            location: z.string().optional(),
            prefix: z.string().optional(),
            registryCountry: z.string().optional(),
            rttMs: z.number().nullable(),
          }),
        )
        .optional(),
      quality: z
        .object({
          address: z.string(),
          sent: z.number(),
          lossPercent: z.number(),
          avgMs: z.number(),
          jitterMs: z.number(),
          terminalConfirmed: z.boolean(),
        })
        .nullable()
        .optional(),
      runs: z.array(speed).optional(),
    })
    .passthrough(),
});
const summary = z.object({
  day: z.string(),
  fingerprint: z.string(),
  operation: z.string(),
  target: z.string(),
  source,
  direction: z.string(),
  samples: z.number(),
  ok: z.number(),
  application: z.number(),
  missing: z.number(),
  failed: z.number(),
  ttfbTotal: z.number(),
  ttfbSamples: z.number(),
  speed: z.record(
    z.object({ sum: z.number(), count: z.number(), bytes: z.number() }),
  ),
});
const catalog = z.object({
  revision: z.number(),
  policies: z.array(policy),
  probes: z.array(probe),
  workers: z.record(
    z.object({
      seenAt: z.number(),
      version: z.string(),
      tools: z.array(z.string()),
      authScheme: z.string(),
    }),
  ),
  inventory: z.array(
    z.object({ uuid: z.string(), name: z.string(), group: z.string() }),
  ),
  inventoryError: z.string().optional(),
  endpoints: z.record(z.object({ address: z.string(), port: z.number() })),
  provider: z.object({
    used: z.number(),
    blockedUntil: z.number(),
    checkedAt: z.number(),
    error: z.string(),
    probes: z.array(
      z.object({
        location: z.object({
          country: z.string(),
          city: z.string(),
          asn: z.number(),
          network: z.string(),
        }),
        tags: z.array(z.string()),
      }),
    ),
  }),
  websites: z.array(z.string()),
  websiteLimit: z.number().default(24),
  websiteCatalog: z
    .array(
      z.object({
        name: z.string(),
        host: z.string(),
        group: z.string(),
        provider: z.string(),
        path: z.string(),
        reference: z.string(),
      }),
    )
    .default([]),
  timezones: z.array(z.string()),
  retention: z.object({ detailDays: z.number(), summaryDays: z.number() }),
});
const reports = z.object({
  records: z.array(record),
  summaries: z.array(summary),
  jobs: z.array(job),
  policies: z.array(policy),
});
const preview = z.object({
  members: z.array(
    z.object({
      id: z.string(),
      jobs: z.array(
        z.object({
          operation: z.string(),
          target: z.string(),
          direction: z.string(),
          source,
          ready: z.boolean(),
          reason: z.string(),
        }),
      ),
    }),
  ),
  nextAt: z.number(),
  trafficAt1GbpsGB: z.number(),
});
export type NativePolicy = z.infer<typeof policy>;
export type NativeRecord = z.infer<typeof record>;
export type NativeCatalog = z.infer<typeof catalog>;
export type NativeSummary = z.infer<typeof summary>;
export type NativeDraft = Omit<NativePolicy, "id" | "nextAt"> & {
  id?: string;
  revision: number;
};
const BASE = "/api/aster-network-observatory/v2";
async function request(
  route: string,
  method = "GET",
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(BASE + route, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
export const nativeCatalog = async () =>
  catalog.parse(await request("/catalog"));
export const nativeReports = async (uuid: string) =>
  reports.parse(await request(`/nodes/${encodeURIComponent(uuid)}/reports`));
export const previewNative = async (draft: NativeDraft) =>
  preview.parse(await request("/preview", "POST", draft));
export const saveNative = (draft: NativeDraft) =>
  request("/policies", "POST", draft);
export const runNative = (id: string) =>
  request(`/policies/${encodeURIComponent(id)}/run`, "POST", {});
export const removeNative = (id: string) =>
  request(`/policies/${encodeURIComponent(id)}`, "DELETE");
export const nativeEndpoint = (
  nodeUuid: string,
  address: string,
  port: number,
) => request("/endpoints", "POST", { nodeUuid, address, port });
export const registerProbe = async (body: unknown) =>
  z
    .object({ id: z.string(), token: z.string() })
    .parse(await request("/probes", "POST", body));
export const revokeProbe = (id: string) =>
  request(`/probes/${encodeURIComponent(id)}`, "DELETE");
