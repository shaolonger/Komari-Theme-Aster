import type { AdminClient, PingTask } from "@/types/komari";
import {
  normalizeHomepagePingTaskBindings,
  type HomepagePingTaskBindings,
} from "@/utils/pingTasks";

export type PingDiagnosticKind = "capability" | "private-target";

export interface PingDiagnostic {
  kind: PingDiagnosticKind;
  taskId: number;
  taskName: string;
  clientUuid: string;
  clientName: string;
  title: string;
  detail: string;
}

function normalizeHostFromTarget(target: string) {
  const trimmed = target.trim();
  if (!trimmed) return "";

  const withScheme =
    /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return url.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
  } catch {
    const withoutPort = trimmed.replace(/^\[(.*)\](?::\d+)?$/, "$1");
    return withoutPort.split(":")[0]?.toLowerCase() ?? "";
  }
}

function isRestrictedIPv4(host: string) {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

export function isRestrictedPingTarget(target: string) {
  const host = normalizeHostFromTarget(target);
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (isRestrictedIPv4(host)) return true;
  const compact = host.replace(/^0+:/, ":");
  return (
    compact === "::1" ||
    compact === "0:0:0:0:0:0:0:1" ||
    compact.startsWith("fc") ||
    compact.startsWith("fd") ||
    compact.startsWith("fe80:")
  );
}

export function buildPingDiagnostics({
  tasks,
  clients,
  bindings,
}: {
  tasks: PingTask[];
  clients: AdminClient[];
  bindings: HomepagePingTaskBindings;
}): PingDiagnostic[] {
  const normalizedBindings = normalizeHomepagePingTaskBindings(bindings);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const clientByUuid = new Map(clients.map((client) => [client.uuid, client]));
  const diagnostics: PingDiagnostic[] = [];

  for (const [taskIdText, clientUuids] of Object.entries(normalizedBindings)) {
    const taskId = Number(taskIdText);
    const task = taskById.get(taskId);
    if (!task) continue;

    const taskName = task.name || `任务 #${task.id}`;
    const restrictedTarget = isRestrictedPingTarget(task.target);
    for (const clientUuid of clientUuids) {
      const client = clientByUuid.get(clientUuid);
      if (!client) continue;

      const clientName = client.name || client.uuid;
      if (client.capability_ping === false) {
        diagnostics.push({
          kind: "capability",
          taskId,
          taskName,
          clientUuid,
          clientName,
          title: "Ping 能力未启用",
          detail: `${clientName} 已绑定 ${taskName}，但 agent 未启用 Ping 能力`,
        });
      }

      if (restrictedTarget && client.capability_private_ping_targets === false) {
        diagnostics.push({
          kind: "private-target",
          taskId,
          taskName,
          clientUuid,
          clientName,
          title: "私有目标 Ping 受限",
          detail: `${clientName} 可能无法探测 ${task.target || "该目标"}`,
        });
      }
    }
  }

  return diagnostics;
}
