import type { AdminClient, PingTask } from "@/types/komari";
import type {
  HomepagePingPrimaryTasks,
  HomepagePingTaskGroups,
} from "@/utils/homepagePingSettings";
import { getHomepagePingTaskIdsByClient, type HomepagePingTaskBindings } from "@/utils/pingTasks";

export interface HomepagePingTaskBindingLabel {
  taskId: number;
  name: string;
  group: string;
}

export interface HomepagePingClientBindingRow {
  uuid: string;
  name: string;
  group: string;
  region: string;
  taskIds: number[];
  taskCount: number;
  primaryTaskId: number | null;
  tasks: HomepagePingTaskBindingLabel[];
}

function taskName(taskId: number, task?: PingTask) {
  return task?.name?.trim() || `任务 #${taskId}`;
}

export function buildHomepagePingClientBindingRows({
  clients,
  tasks,
  bindings,
  primaryTasks = {},
  taskGroups = {},
}: {
  clients: AdminClient[];
  tasks: PingTask[];
  bindings: HomepagePingTaskBindings;
  primaryTasks?: HomepagePingPrimaryTasks;
  taskGroups?: HomepagePingTaskGroups;
}): HomepagePingClientBindingRow[] {
  const taskIdsByClient = getHomepagePingTaskIdsByClient(bindings);
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  return clients
    .map((client) => {
      const taskIds = taskIdsByClient.get(client.uuid) ?? [];
      if (taskIds.length === 0) return null;
      const primaryTaskId =
        primaryTasks[client.uuid] != null && taskIds.includes(primaryTasks[client.uuid])
          ? primaryTasks[client.uuid]
          : null;
      return {
        uuid: client.uuid,
        name: client.name || client.uuid,
        group: String(client.group || ""),
        region: String(client.region || ""),
        taskIds,
        taskCount: taskIds.length,
        primaryTaskId,
        tasks: taskIds.map((taskId) => ({
          taskId,
          name: taskName(taskId, taskById.get(taskId)),
          group: taskGroups[String(taskId)] ?? "",
        })),
      };
    })
    .filter((row): row is HomepagePingClientBindingRow => Boolean(row));
}
