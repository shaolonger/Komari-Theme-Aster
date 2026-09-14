// Generated from Komari contracts/rpc-v2.json. Do not edit by hand.
export const RPC_CONTRACT = "komari.rpc.v2.4" as const;
export const RPC_JSON_VERSION = "2.0" as const;
export const RPC_MINIMUM_SERVER_VERSION = "1.4.0" as const;

export const RPC_CAPABILITIES = {
  "metric.definitions": "1",
  "metric.migration": "1",
  "metric.query": "1",
  "history.set-query": "1",
  "ping.leases": "1",
  "ping.overview": "2",
  "ping.result-batch": "1",
  "realtime.delta": "1",
  "storage.embedded": "1",
  "telemetry.v2": "2",
  "telemetry.v3": "3",
} as const;

export const RPC_METHODS = [
  "rpc.discover",
  "rpc.ping",
  "common:getNodes",
  "common:getNodesLatestStatus",
  "common:getRecords",
  "common:getRealtimeDelta",
  "common:getVersion",
  "common:getPingOverview",
  "public:getPublicPingTasks",
  "public:listMetricDefinitions",
  "public:queryMetrics",
  "public:getPingMetricStats",
  "admin:listMetricDefinitions",
  "admin:updateMetricDefinition",
  "admin:getMetricMigrationStatus",
  "admin:startMetricMigration",
  "admin:cancelMetricMigration",
] as const;

export type RpcMethod = (typeof RPC_METHODS)[number];
export type RpcCapability = keyof typeof RPC_CAPABILITIES;

export interface RpcDiscovery {
  jsonrpc_version: string;
  contract: string;
  methods: string[];
  capabilities: Record<string, string>;
}

export interface RealtimeDelta {
  sequence: number;
  snapshot: boolean;
  resync?: boolean;
  reports?: Record<string, unknown>;
  removed?: string[];
  online?: string[];
  offline?: string[];
}

export interface PingOverviewStat {
  name: string;
  total: number;
  lost: number;
  loss: number;
  min: number;
  max: number;
  avg: number;
  latest: number;
  tail: number;
}

export interface PingOverviewResult {
  from: string | number;
  to: string | number;
  tasks: Array<{ id: number; name: string; type: string; interval: number }>;
  stats: Record<string, Record<string, PingOverviewStat>>;
  series: Record<string, Record<string, Array<{
    time: string | number;
    value: number;
    sample_count: number;
    loss_count: number;
    loss: number;
  }>>>;
}
