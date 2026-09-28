import { z } from "zod";

export const NETWORK_OBSERVATORY_API = "/api/aster-network-observatory/v1";

export const NetworkModeSchema = z.enum([
  "https",
  "route",
  "throughput",
  "tcpquality-route",
  "tcpquality-intl",
  "tcpquality-all",
]);
export const NetworkScheduleSchema = z.object({
  id: z.string(),
  name: z.string(),
  mode: NetworkModeSchema,
  enabled: z.boolean(),
  target: z.string(),
  carrier: z.string(),
  region: z.string(),
  port: z.number(),
  intervalMinutes: z.number(),
  clients: z.array(z.string()),
  nextRunAt: z.number(),
  revision: z.number().default(0),
  sourcePolicy: z.string().default(""),
  customized: z.boolean().default(false),
  catalogVersion: z.string().default(""),
});
export const NetworkResultSchema = z.object({
  completedAt: z.string(),
  taskId: z.string().optional(),
  runnerVersion: z.string().optional(),
  catalogVersion: z.string().optional(),
  mode: NetworkModeSchema,
  target: z.string(),
  status: z.enum(["success", "failed", "timeout"]),
  exitCode: z.number(),
  rawOutput: z.string(),
  scheduleId: z.string(),
  nodeUuid: z.string(),
  nodeName: z.string(),
  carrier: z.string(),
  region: z.string(),
});
export const NetworkAgentSchema = z.object({
  uuid: z.string(),
  tokenIssuedAt: z.string(),
  lastSeenAt: z.string(),
  capabilities: z.array(z.string()).nullish(),
  runnerVersion: z.string().optional(),
  capabilitiesAt: z.string().optional(),
});
export const NetworkStatusSchema = z.object({
  config: z.object({ schedules: z.array(NetworkScheduleSchema) }),
  pending: z.number(),
  history: z.array(NetworkResultSchema),
  updatedAt: z.string(),
  modes: z.array(NetworkModeSchema),
  intervals: z.array(z.number()),
  registeredNodes: z.array(NetworkAgentSchema),
});

export type NetworkSchedule = z.infer<typeof NetworkScheduleSchema>;
export type NetworkResult = z.infer<typeof NetworkResultSchema>;
export type NetworkMode = z.infer<typeof NetworkModeSchema>;
export type NetworkAgent = z.infer<typeof NetworkAgentSchema>;
export type NetworkStatus = z.infer<typeof NetworkStatusSchema>;

async function request<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, init?: RequestInit): Promise<T> {
  const response = await fetch(`${NETWORK_OBSERVATORY_API}${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error
      : `网络观测接口返回 HTTP ${response.status}`;
    throw new Error(message);
  }
  return schema.parse(body);
}

export function getNetworkObservatoryStatus(): Promise<NetworkStatus> {
  return request("/status", NetworkStatusSchema);
}

export function saveNetworkObservatorySchedules(schedules: NetworkSchedule[]): Promise<{ config: { schedules: NetworkSchedule[] } }> {
  const responseSchema = z.object({ config: z.object({ schedules: z.array(NetworkScheduleSchema) }) });
  return request("/config", responseSchema, {
    method: "PUT",
    body: JSON.stringify({ schedules }),
  }) as Promise<{ config: { schedules: NetworkSchedule[] } }>;
}

export function runNetworkObservatorySchedule(scheduleId: string): Promise<{ task: { taskId: string } }> {
  const responseSchema = z.object({ task: z.object({ taskId: z.string() }) });
  return request(`/run/${encodeURIComponent(scheduleId)}`, responseSchema, {
    method: "POST",
  }) as Promise<{ task: { taskId: string } }>;
}

export function issueNetworkObservatoryToken(nodeUuid: string): Promise<{ uuid: string; token: string }> {
  const responseSchema = z.object({ uuid: z.string(), token: z.string().regex(/^[0-9a-f]{64}$/) });
  return request(`/nodes/${encodeURIComponent(nodeUuid)}/token`, responseSchema, {
    method: "POST",
    body: "{}",
  });
}

export function revokeNetworkObservatoryToken(nodeUuid: string): Promise<{ registeredNodes: NetworkAgent[]; config: { schedules: NetworkSchedule[] } }> {
  const responseSchema = z.object({
    registeredNodes: z.array(NetworkAgentSchema),
    config: z.object({ schedules: z.array(NetworkScheduleSchema) }),
  });
  return request(`/nodes/${encodeURIComponent(nodeUuid)}/token`, responseSchema, {
    method: "DELETE",
  });
}

const InventoryNodeSchema = z.object({ uuid: z.string(), name: z.string(), group: z.string() });
const PolicySettingsSchema = z.object({ target: z.string(), port: z.number(), intervalMinutes: z.number() });
const PolicySchema = z.object({
  id: z.string(), name: z.string(), presetId: z.string(), catalogVersion: z.string(),
  clients: z.array(z.string()), groups: z.array(z.string()), enabled: z.boolean(),
  settings: PolicySettingsSchema, revision: z.number(), trafficAccepted: z.boolean(),
});
const PresetSchema = z.object({
  id: z.string(), name: z.string(), description: z.string(), source: z.string(), requirement: z.string(),
  customTarget: z.boolean().optional(), traffic: z.boolean().optional(),
  items: z.array(z.object({ id: z.string(), name: z.string(), mode: NetworkModeSchema, target: z.string(), port: z.number().optional(), intervalMinutes: z.number() })),
});
const CatalogSchema = z.object({
  apiVersion: z.literal(2), version: z.string(), presets: z.array(PresetSchema), policies: z.array(PolicySchema),
  inventory: z.array(InventoryNodeSchema), inventoryAt: z.string(), inventoryError: z.string(), nodes: z.array(NetworkAgentSchema),
});
const HistorySchema = z.object({ items: z.array(NetworkResultSchema), total: z.number(), nextCursor: z.string() });
const TaskSchema = z.object({ taskId: z.string(), scheduleId: z.string(), mode: NetworkModeSchema, target: z.string(), status: z.enum(["queued", "running"]), queuedAt: z.number(), startedAt: z.number() });
const NodeStatusSchema = z.object({
  apiVersion: z.literal(2), schedules: z.array(NetworkScheduleSchema), tasks: z.array(TaskSchema), node: NetworkAgentSchema.nullable(), latest: z.array(NetworkResultSchema), history: HistorySchema, policies: z.array(PolicySchema), inventoryError: z.string(),
});
export type NetworkCatalog = z.infer<typeof CatalogSchema>;
export type NetworkPolicy = z.infer<typeof PolicySchema>;
export type NodeNetworkStatus = z.infer<typeof NodeStatusSchema>;
export type NetworkHistory = z.infer<typeof HistorySchema>;
export type NetworkPreset = z.infer<typeof PresetSchema>;
export type ApplyNetworkPolicies = { presetIds: string[]; clients: string[]; groups: string[]; inherit: boolean; settingsByPreset?: Record<string, { target?: string; port?: number; intervalMinutes?: number }>; settings?: { target?: string; port?: number; intervalMinutes?: number }; trafficAccepted: boolean };
const PreviewNodeSchema = InventoryNodeSchema.extend({ state: z.string(), planCount: z.number() });
const PreviewSchema = z.object({ planCount: z.number(), added: z.number(), unchanged: z.number(), nodes: z.array(PreviewNodeSchema) });
export type NetworkPreview = z.infer<typeof PreviewSchema>;
const nodePath = (uuid: string) => `/nodes/${encodeURIComponent(uuid)}`;
const jsonBody = (body: unknown) => JSON.stringify(body);
export const getNetworkCatalog = () => request("/catalog", CatalogSchema);
export const getNodeNetworkStatus = (uuid: string) => request(`${nodePath(uuid)}/status`, NodeStatusSchema);
export const getNetworkHistory = (uuid: string, cursor = "", mode = "") => request(`${nodePath(uuid)}/history?before=${encodeURIComponent(cursor)}&mode=${encodeURIComponent(mode)}`, HistorySchema);
export const previewNetworkPolicies = (input: ApplyNetworkPolicies) => request("/policies/preview", PreviewSchema, { method: "POST", body: jsonBody(input) });
export const applyNetworkPolicies = (input: ApplyNetworkPolicies) => request("/policies/apply", z.object({ added: z.number() }), { method: "POST", body: jsonBody(input) });
export const updateNetworkPolicy = (policy: NetworkPolicy) => request(`/policies/${encodeURIComponent(policy.id)}`, z.object({ policy: PolicySchema }), { method: "PUT", body: jsonBody(policy) });
export const deleteNetworkPolicy = (policy: NetworkPolicy) => request(`/policies/${encodeURIComponent(policy.id)}?revision=${policy.revision}`, z.object({ ok: z.boolean() }), { method: "DELETE" });
export const saveNodeNetworkPlan = (uuid: string, plan: NetworkSchedule, trafficAccepted = false) => request(`${nodePath(uuid)}/plans/${encodeURIComponent(plan.id)}`, z.object({ plan: NetworkScheduleSchema }), { method: "PUT", body: jsonBody({ ...plan, trafficAccepted }) });
export const deleteNodeNetworkPlan = (uuid: string, plan: NetworkSchedule) => request(`${nodePath(uuid)}/plans/${encodeURIComponent(plan.id)}?revision=${plan.revision}`, z.object({ ok: z.boolean() }), { method: "DELETE" });
export const runNodeNetworkTest = (uuid: string, plan: NetworkSchedule, trafficAccepted = false) => request(`${nodePath(uuid)}/test`, z.object({ task: TaskSchema }), { method: "POST", body: jsonBody({ ...plan, trafficAccepted }) });
