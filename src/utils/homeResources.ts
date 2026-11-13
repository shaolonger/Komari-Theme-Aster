import type { HomeNodeSummary } from "@/services/wsStore";
import type { NodeInfo } from "@/types/komari";
import { resolveTrafficUsage } from "@/utils/traffic";

type ResourceNode = Pick<HomeNodeSummary, "uuid" | "updatedAt" | "trafficUp" | "trafficDown">;
type ResourceMeta = Pick<NodeInfo, "mem_total" | "traffic_limit" | "traffic_limit_type">;

/** Aggregate the visible fleet, independently of search, groups and online state. */
export function summarizeHomeResources(
  nodes: readonly ResourceNode[],
  metadata: ReadonlyMap<string, ResourceMeta>,
) {
  const result = {
    memoryTotal: 0,
    memoryMissing: 0,
    limitedCount: 0,
    limitedMeasured: 0,
    limitedUsed: 0,
    limitedQuota: 0,
    limitedRemaining: 0,
    unlimitedCount: 0,
    unlimitedMeasured: 0,
    unlimitedUsed: 0,
    metadataMissing: 0,
  };
  for (const node of nodes) {
    const meta = metadata.get(node.uuid);
    if (meta && Number.isFinite(meta.mem_total) && meta.mem_total > 0) {
      result.memoryTotal += meta.mem_total;
    } else {
      result.memoryMissing++;
    }
    if (!meta || !Number.isFinite(meta.traffic_limit)) {
      result.metadataMissing++;
      continue;
    }
    const usage = resolveTrafficUsage(meta.traffic_limit_type, node.trafficUp, node.trafficDown, meta.traffic_limit);
    const measured = node.updatedAt > 0 && Number.isFinite(node.trafficUp) && Number.isFinite(node.trafficDown);
    if (usage.unlimited) {
      result.unlimitedCount++;
      if (measured) {
        result.unlimitedMeasured++;
        result.unlimitedUsed += usage.used;
      }
    } else {
      result.limitedCount++;
      result.limitedQuota += usage.limit;
      if (measured) {
        result.limitedMeasured++;
        result.limitedUsed += usage.used;
        // A node's unused allowance cannot cover another node's overage.
        result.limitedRemaining += usage.remaining;
      }
    }
  }
  return result;
}

export type HomeResourceSummary = ReturnType<typeof summarizeHomeResources>;
