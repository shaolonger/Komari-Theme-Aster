import {
  getHomepagePingTaskIdsByClient,
  type HomepagePingTaskBindings,
} from "@/utils/pingTasks";

export const HOMEPAGE_PING_AGGREGATION_STRATEGIES = [
  "worst",
  "primary",
  "average",
] as const;

export type HomepagePingAggregationStrategy =
  (typeof HOMEPAGE_PING_AGGREGATION_STRATEGIES)[number];
export type HomepagePingPrimaryTasks = Record<string, number>;
export type HomepagePingTaskGroups = Record<string, string>;

export const DEFAULT_HOMEPAGE_PING_AGGREGATION_STRATEGY: HomepagePingAggregationStrategy =
  "worst";

export function isHomepagePingAggregationStrategy(
  value: unknown,
): value is HomepagePingAggregationStrategy {
  return (
    typeof value === "string" &&
    (HOMEPAGE_PING_AGGREGATION_STRATEGIES as readonly string[]).includes(value)
  );
}

export function normalizeHomepagePingAggregationStrategy(
  value: unknown,
): HomepagePingAggregationStrategy {
  return isHomepagePingAggregationStrategy(value)
    ? value
    : DEFAULT_HOMEPAGE_PING_AGGREGATION_STRATEGY;
}

export function normalizeHomepagePingPrimaryTasks(
  value: unknown,
  bindings?: HomepagePingTaskBindings,
): HomepagePingPrimaryTasks {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const taskIdsByClient = bindings ? getHomepagePingTaskIdsByClient(bindings) : null;
  const normalized: HomepagePingPrimaryTasks = {};
  for (const [clientUuid, taskIdValue] of Object.entries(value)) {
    const uuid = clientUuid.trim();
    const taskId = Number(taskIdValue);
    if (!uuid || !Number.isInteger(taskId) || taskId <= 0) {
      continue;
    }
    if (taskIdsByClient && !(taskIdsByClient.get(uuid) ?? []).includes(taskId)) {
      continue;
    }
    normalized[uuid] = taskId;
  }

  return normalized;
}

export function normalizeHomepagePingTaskGroups(
  value: unknown,
): HomepagePingTaskGroups {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: HomepagePingTaskGroups = {};
  for (const [taskId, labelValue] of Object.entries(value)) {
    const numericTaskId = Number(taskId);
    const label = typeof labelValue === "string" ? labelValue.trim() : "";
    if (!Number.isInteger(numericTaskId) || numericTaskId <= 0 || !label) {
      continue;
    }
    normalized[String(numericTaskId)] = label.slice(0, 36);
  }

  return normalized;
}

export function filterHomepagePingTaskGroups(
  taskGroups: HomepagePingTaskGroups,
  availableTaskIds: Iterable<number>,
): HomepagePingTaskGroups {
  const available = new Set(
    Array.from(availableTaskIds).filter(
      (taskId) => Number.isInteger(taskId) && taskId > 0,
    ),
  );
  const filtered: HomepagePingTaskGroups = {};

  for (const [taskId, label] of Object.entries(normalizeHomepagePingTaskGroups(taskGroups))) {
    if (available.has(Number(taskId))) {
      filtered[taskId] = label;
    }
  }

  return filtered;
}
