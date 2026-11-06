import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { Flag } from "@/components/ui/Flag";
import { Cpu, MemoryStick, Network } from "lucide-react";
import { formatBytes } from "@/utils/format";
import { regionLabel } from "@/components/glacier/regionLabel";
import { instanceViews, type InstanceView } from "@/utils/instanceView";
export default function CupertinoInstanceHeading({
  uuid,
  view,
}: {
  uuid: string;
  view: InstanceView;
}) {
  const model = useNodeCardModel(uuid);
  const { node } = model;
  const tags = model.node ? model.tags : [];
  const load = view === "load",
    title = instanceViews.find((v) => v.id === view)!;
  return (
    <div className="cupertino-instance-heading">
      <p className="cupertino-breadcrumb">
        服务器 <span>/</span>{" "}
        {load ? regionLabel(node?.region) : node?.name || uuid} <span>/</span>
        <strong>
          {load ? "节点详情" : view === "ping" ? "网络诊断" : title.label}
        </strong>
      </p>
      <h1>
        {load ? node?.name || uuid : view === "ping" ? "网络诊断" : title.title}
        {load && (
          <span className="cupertino-status" data-online={node?.online}>
            {node?.online === true
              ? "在线"
              : node?.online === false
                ? "离线"
                : "待上报"}
          </span>
        )}
      </h1>
      {load ? (
        <div className="cupertino-instance-tags">
          <span>
            <Flag region={node?.region} size={21} />
            {regionLabel(node?.region)}
          </span>
          <span>
            <Cpu size={16} />
            {node?.cpu_cores || "—"} vCPU
          </span>
          <span>
            <MemoryStick size={16} />
            {formatBytes(node?.ramTotal || 0)} 内存
          </span>
          <span>{node?.os || "系统未上报"}</span>
          {node?.virtualization && (
            <span>
              <Network size={15} />
              {node.virtualization}
            </span>
          )}
          {node?.ipv4 && (
            <span className="cupertino-ip-chip" title={node.ipv4}>
              IPv4
            </span>
          )}
          {node?.ipv6 && (
            <span className="cupertino-ip-chip" title={node.ipv6}>
              IPv6
            </span>
          )}
          {tags?.length ? (
            <span
              className="cupertino-instance-tag-list"
              title={tags.map((tag) => tag.label).join(" · ")}
            >
              标签：{tags.map((tag) => tag.label).join(" · ")}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="cupertino-instance-description">
          {view === "ping"
            ? "延迟、丢包与线路稳定性，清楚呈现。"
            : title.description}
        </p>
      )}
    </div>
  );
}
