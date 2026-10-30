export type InstanceView = "load" | "ping" | "traffic" | "network";

/** Metric/asset anchors still open the performance view; only these three
 * explicit workspaces change the tab. The URL also restores Back/Forward. */
export function resolveInstanceView(focus: string | null): InstanceView {
  return focus === "ping" || focus === "traffic" || focus === "network"
    ? focus
    : "load";
}

export const instanceViews = [
  {
    id: "load",
    label: "负载",
    title: "性能趋势",
    description: "CPU、内存、磁盘、网络、连接数与进程的资源变化。",
  },
  {
    id: "ping",
    label: "Ping",
    title: "网络诊断",
    description: "查看监控线路的延迟、丢包、异常时段与线路质量。",
  },
  {
    id: "traffic",
    label: "流量",
    title: "流量统计",
    description: "查看所选时段的上下行用量、采样覆盖与流量配额。",
  },
  {
    id: "network",
    label: "网络检测",
    title: "网络检测",
    description: "管理探测器、检测计划，查看路由、测速与质量报告。",
  },
] as const;
