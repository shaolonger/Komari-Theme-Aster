import { z } from "zod";

export const reportModules = [
  "routes",
  "tcp-quality",
  "china-speed",
  "international",
  "idc",
  "international-speed",
  "bgp",
] as const;
export type ReportModule = (typeof reportModules)[number];
const moduleName = z.enum(reportModules);
const nullableNumber = z.number().finite().nonnegative().nullable();
export const timingSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("interval"),
    minutes: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("daily"),
    times: z.array(z.string()),
    timezone: z.string(),
  }),
]);
const sourceSchema = z
  .object({
    provider: z.string().default(""),
    name: z.string().optional(),
    city: z.string().optional(),
    carrier: z.string().optional(),
    id: z.string().optional(),
    country: z.string().optional(),
    asn: z.number().optional(),
    accessType: z.string().optional(),
    network: z.string().optional(),
    runnerVersion: z.string().optional(),
  })
  .passthrough();
const endpointSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    address: z.string(),
    port: z.number(),
    category: z.string(),
    provider: z.string().default(""),
    city: z.string().optional(),
    carrier: z.string().optional(),
    country: z.string().optional(),
    regionCode: z.string().optional(),
    family: z.string(),
    uses: z.array(z.string()),
    sourceUrl: z.string(),
    restrictions: z.string().default(""),
    conditions: z.string().default(""),
    catalogVersion: z.string(),
    checkedAt: z.string(),
    health: z.string(),
    method: z.string().optional(),
    path: z.string().optional(),
    uploadPath: z.string().optional(),
    https: z.boolean().optional(),
    authorized: z.boolean().optional(),
  })
  .passthrough();
export const moduleSchema = z.object({
  module: moduleName,
  preset: z.string().optional(),
  endpoints: z.array(z.string()),
  family: z.enum(["4", "6"]),
  protocols: z.array(z.enum(["tcp", "icmp"])),
  sources: z.array(z.string()),
  publicSources: z.boolean(),
  samples: z.number().optional(),
  packetSizes: z.array(z.number()).optional(),
  maxTrafficMiB: z.number().optional(),
  seconds: z.number(),
  warmupSeconds: z.number(),
  streams: z.array(z.number()),
  enabled: z.boolean(),
  timing: timingSchema,
  nextAt: z.number(),
});
const suiteSchema = z.object({
  id: z.string(),
  name: z.string(),
  clients: z.array(z.string()),
  groups: z.array(z.string()),
  inherit: z.boolean(),
  enabled: z.boolean(),
  trafficAccepted: z.boolean(),
  modules: z.array(moduleSchema),
  catalogVersion: z.string(),
});
const countsSchema = z.object({
  expected: z.number(),
  completed: z.number(),
  ok: z.number(),
  partial: z.number(),
  failed: z.number(),
  missing: z.number(),
  cancelled: z.number(),
});
const roundSummarySchema = z.object({
  id: z.string(),
  nodeUuid: z.string(),
  module: moduleName,
  suiteId: z.string(),
  batchId: z.string().optional(),
  schema: z.literal(3),
  plannedAt: z.string(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  state: z.enum([
    "running",
    "complete",
    "partial",
    "missing",
    "failed",
    "cancelled",
  ]),
  counts: countsSchema,
  detailAvailable: z.boolean().default(true),
});
const sampleSchema = z.object({
  index: z.number().int(),
  state: z.enum(["ok", "timeout", "refused", "failed"]),
  rttMs: nullableNumber,
  address: z.string(),
  error: z.string(),
});
const hopSchema = z
  .object({
    ttl: z.number(),
    address: z.string(),
    asn: z.string(),
    rttMs: nullableNumber,
    network: z.string().optional(),
    asnStatus: z.string().optional(),
    asnSource: z.string().optional(),
    asnQueriedAt: z.string().optional(),
    location: z.string().optional(),
    domain: z.string().optional(),
    whois: z.string().optional(),
    hostname: z.string().optional(),
    geoSource: z.string().optional(),
    geoQueriedAt: z.string().optional(),
    geoStatus: z.string().optional(),
    registryCountry: z.string().optional(),
    prefix: z.string().optional(),
    sent: z.number().optional(),
    received: z.number().optional(),
    receivedEstimated: z.boolean().optional(),
    lossPercent: nullableNumber.optional(),
    lastMs: nullableNumber.optional(),
    avgMs: nullableNumber.optional(),
    bestMs: nullableNumber.optional(),
    worstMs: nullableNumber.optional(),
    stdevMs: nullableNumber.optional(),
  })
  .passthrough();
const speedRunSchema = z
  .object({
    direction: z.string(),
    streams: z.number(),
    state: z.string(),
    vpsDirection: z.string().optional(),
    intervalSource: z.string().optional(),
    congestionControl: z.string().optional(),
    measurementBasis: z.string().optional(),
    medianBitsPerSecond: nullableNumber.optional(),
    receiverConfirmed: z.boolean().optional(),
    remoteIp: z.string().optional(),
    trafficBytesObserved: nullableNumber.optional(),
    warmupBytesObserved: nullableNumber.optional(),
    tcpRttMethod: z.string().optional(),
    tcpSampleSide: z.string().optional(),
    bitsPerSecond: nullableNumber.optional(),
    bytes: nullableNumber.optional(),
    seconds: nullableNumber.optional(),
    retransmits: nullableNumber.optional(),
    tcpRttMs: nullableNumber.optional(),
    maxBitsPerSecond: nullableNumber.optional(),
    intervals: z
      .array(
        z
          .object({
            start: z.number().optional(),
            end: z.number().optional(),
            seconds: z.number(),
            bitsPerSecond: nullableNumber,
            bytes: nullableNumber.optional(),
          })
          .passthrough(),
      )
      .default([]),
    diagnostic: z.string().default(""),
  })
  .passthrough();
const measurementDataSchema = z
  .object({
    kind: z.string(),
    state: z.string(),
    method: z.string().optional(),
    diagnostic: z.string().default(""),
    rawOutput: z.string().optional(),
    complete: z.boolean().optional(),
    resolvedIp: z.string().optional(),
    protocol: z.string().optional(),
    metadataObservation: z.object({
      method: z.string().optional(),
      state: z.string().optional(),
      target: z.string().optional(),
      resolvedIp: z.string().optional(),
      protocol: z.string().optional(),
      port: z.number().optional(),
      exitCode: z.number().optional(),
      parseError: z.string().optional(),
      diagnostic: z.string().optional(),
      conditions: z.string().optional(),
      startedAt: z.string().optional(),
      completedAt: z.string().optional(),
      queriedAt: z.string().optional(),
      durationMs: z.number().optional(),
      complete: z.boolean().optional(),
      stopReason: z.string().optional(),
      matchedIps: z.array(z.string()).optional(),
      hops: z.array(hopSchema).max(32).optional(),
      stdout: z.string().optional(),
      stderr: z.string().optional(),
      stdoutTruncated: z.boolean().optional(),
      stderrTruncated: z.boolean().optional(),
      metadataTruncated: z.boolean().optional(),
    }).optional(),
    tcpQuality: z
      .object({
        method: z.string(),
        address: z.string(),
        state: z.string(),
        sent: z.number(),
        received: z.number(),
        failurePercent: nullableNumber,
        avgMs: nullableNumber,
        medianMs: nullableNumber.optional(),
        minMs: nullableNumber,
        maxMs: nullableNumber,
        stdevMs: nullableNumber,
        samples: z.array(sampleSchema),
      })
      .optional(),
    hops: z.array(hopSchema).optional(),
    routeChange: z
      .object({
        comparable: z.boolean(),
        previousRoundId: z.string().nullable(),
        previousCompletedAt: z.string().nullable(),
        observedAsPathChanged: z.boolean().nullable(),
        previousAsPath: z.array(z.string()),
        currentAsPath: z.array(z.string()),
        conditions: z.string(),
      })
      .optional(),
    synProbes: z.array(z.object({ method: z.string(), payloadBytes: z.number(), state: z.string(), sent: z.number(), received: z.number(),
      unansweredPercent: nullableNumber, minMs: nullableNumber, avgMs: nullableNumber, maxMs: nullableNumber,
      diagnostic: z.string().optional(), conditions: z.string().optional(), rawOutput: z.string().max(8000).optional() })).optional(),
    actualEndpoint: z.object({ id: z.string(), name: z.string(), ip: z.string(), port: z.number(), city: z.string(), carrier: z.string(), family: z.string() }).passthrough().optional(),
    missingCoverage: z.boolean().optional(),
    runs: z.array(speedRunSchema).optional(),
    https: z
      .object({
        state: z.string(),
        httpStatus: z.number().optional(),
        diagnostic: z.string().optional(),
        timingsMs: z.record(z.number()).optional(),
        tlsVerified: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
const slotSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  target: z.string(),
  direction: z.string(),
  source: sourceSchema,
  endpoint: endpointSchema.nullable(),
  options: z.record(z.unknown()),
  state: z.string(),
  missingReason: z.string(),
  waitReason: z.string().optional(),
  metrics: z.record(z.unknown()).optional(),
  completedAt: z.string().optional(),
});
const measurementSchema = z.object({
  id: z.string(),
  roundId: z.string(),
  slotId: z.string(),
  nodeUuid: z.string(),
  target: z.string(),
  direction: z.string(),
  operation: z.string(),
  pairId: z.string(),
  executor: z.string(),
  source: sourceSchema,
  options: z.record(z.unknown()),
  startedAt: z.string().nullable(),
  completedAt: z.string(),
  data: measurementDataSchema,
});
const roundSchema = roundSummarySchema.extend({
  parameters: moduleSchema,
  catalogVersion: z.string(),
  slots: z.array(slotSchema),
  measurements: z.array(measurementSchema),
});
const capabilitiesSchema = z.object({
  schema: z.literal(3),
  features: z.array(z.string()),
  modules: z.array(moduleName),
  maxTargetsPerRound: z.number(),
  retention: z.object({ detailDays: z.number(), summaryDays: z.number() }),
});
const catalogSchema = capabilitiesSchema.extend({
  catalogVersion: z.string(),
  endpoints: z.array(endpointSchema),
  presets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      module: moduleName,
      endpoints: z.array(z.string()),
      timing: timingSchema,
      publicSources: z.boolean().optional(),
      traffic: z.boolean().optional(),
    }),
  ),
  suites: z.array(suiteSchema),
  homeRouteNodes: z.array(z.string()).default([]),
  homeRouteDisplay: z.boolean().default(true),
  revision: z.number(),
  inventory: z.array(
    z.object({
      uuid: z.string(),
      name: z.string(),
      group: z.string(),
      ip: z.string(),
      publicVisible: z.boolean().default(false),
    }),
  ),
  timezones: z.array(z.string()),
  probes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      city: z.string(),
      carrier: z.string(),
      online: z.boolean(),
      publicAddress: z.string().optional(),
      accessType: z.string().optional(),
    }),
  ),
});
const previewSchema = z.object({
  suite: suiteSchema,
  exceedsCapacity: z.boolean(),
  nodes: z.array(
    z.object({
      uuid: z.string(),
      name: z.string(),
      capacity: z.object({
        measurementsPerDay: z.number(),
        samplesPerDay: z.number(),
        speedSecondsPerDay: z.number(),
        estimatedLightSecondsPerDay: z.number(),
      }),
      modules: z.array(
        z.object({
          module: moduleName,
          nextAt: z.number(),
          expected: z.number(),
          estimatedQueueSeconds: z.number(),
          targets: z.array(
            z.object({
              slotId: z.string(),
              target: z.string(),
              direction: z.string(),
              source: sourceSchema,
              ready: z.boolean(),
              reason: z.string(),
            }),
          ),
        }),
      ),
    }),
  ),
});
export type ReportCatalog = z.infer<typeof catalogSchema>;
export type ReportEndpoint = z.infer<typeof endpointSchema>;
export type ReportSuite = z.infer<typeof suiteSchema>;
export type ReportModuleConfig = z.infer<typeof moduleSchema>;
export type ReportRound = z.infer<typeof roundSchema>;
export type RoundSummary = z.infer<typeof roundSummarySchema>;
export type ReportMeasurement = z.infer<typeof measurementSchema>;
export type ReportSlot = z.infer<typeof slotSchema>;
export type ReportHop = z.infer<typeof hopSchema>;
export type ReportSample = z.infer<typeof sampleSchema>;
export type ReportDraft = Omit<ReportSuite, "id" | "catalogVersion"> & {
  id?: string;
  revision: number;
};
async function request(
  route: string,
  method = "GET",
  body?: unknown,
): Promise<unknown> {
  const res = await fetch("/api/aster-network-observatory/v3" + route, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `网络报告 API 返回 HTTP ${res.status}；请确认插件版本和登录状态`,
    );
  }
  if (!res.ok)
    throw new Error(
      typeof data === "object" && data && "error" in data
        ? String(data.error)
        : `HTTP ${res.status}`,
    );
  return data;
}
export const reportCapabilities = async () =>
  capabilitiesSchema.parse(await request("/capabilities"));
export const reportCatalog = async () =>
  catalogSchema.parse(await request("/catalog"));
export const listReportRounds = async (
  uuid: string,
  module: ReportModule,
  cursor = "",
) =>
  z
    .object({
      rounds: z.array(roundSummarySchema),
      nextCursor: z.string().nullable(),
    })
    .parse(
      await request(
        `/nodes/${encodeURIComponent(uuid)}/rounds?module=${module}&cursor=${encodeURIComponent(cursor)}`,
      ),
    );
export const getReportRound = async (uuid: string, id: string) =>
  roundSchema.parse(
    await request(
      `/nodes/${encodeURIComponent(uuid)}/rounds/${encodeURIComponent(id)}`,
    ),
  );
export const runReportSuite = (id: string, module?: ReportModule, nodeUuids?: string[]) =>
  request(`/suites/${encodeURIComponent(id)}/run`, "POST", { module, nodeUuids });
export const cancelReportRound = (uuid: string, id: string) =>
  request(
    `/nodes/${encodeURIComponent(uuid)}/rounds/${encodeURIComponent(id)}/cancel`,
    "POST",
    {},
  );
export const saveReportSuite = (draft: ReportDraft) =>
  request("/suites", "POST", draft);
export const previewReportSuite = async (draft: ReportDraft) =>
  previewSchema.parse(await request("/preview", "POST", draft));
export const deleteReportSuite = (id: string) =>
  request(`/suites/${encodeURIComponent(id)}`, "DELETE");

export const saveReportResource = (input: Record<string, unknown>) =>
  request("/resources", "POST", input);
export const deleteReportResource = (id: string) =>
  request(`/resources/${encodeURIComponent(id)}`, "DELETE");
export const shareReportRound = async (uuid: string, id: string) =>
  z
    .object({ id: z.string(), url: z.string(), expiresAt: z.number() })
    .parse(
      await request(
        `/nodes/${encodeURIComponent(uuid)}/rounds/${encodeURIComponent(id)}/share`,
        "POST",
        {},
      ),
    );
export const revokeReportShares = (uuid: string, id: string) =>
  request(
    `/nodes/${encodeURIComponent(uuid)}/rounds/${encodeURIComponent(id)}/shares`,
    "DELETE",
  );

export const publishHomeRoutes = (nodeUuids: string[], revision: number, display: boolean) => request("/home-routes", "PUT", { nodeUuids, revision, display });

export const rebuildHomeRoutes = () => request("/home-routes/rebuild", "POST", {});
