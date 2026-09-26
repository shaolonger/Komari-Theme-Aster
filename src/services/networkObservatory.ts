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
});
export const NetworkResultSchema = z.object({
  completedAt: z.string(),
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
export const NetworkStatusSchema = z.object({
  config: z.object({ schedules: z.array(NetworkScheduleSchema) }),
  pending: z.number(),
  history: z.array(NetworkResultSchema),
  updatedAt: z.string(),
  modes: z.array(NetworkModeSchema),
  intervals: z.array(z.number()),
});

export type NetworkSchedule = z.infer<typeof NetworkScheduleSchema>;
export type NetworkResult = z.infer<typeof NetworkResultSchema>;
export type NetworkMode = z.infer<typeof NetworkModeSchema>;
export type NetworkStatus = z.infer<typeof NetworkStatusSchema>;

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
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
