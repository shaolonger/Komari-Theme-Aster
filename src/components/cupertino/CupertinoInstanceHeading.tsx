import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { Flag } from "@/components/ui/Flag";
import { Cpu, MemoryStick, Network } from "lucide-react";
import { formatBytes } from "@/utils/format";
import { regionLabel } from "@/utils/regionLabel";
export default function CupertinoInstanceHeading({ uuid }: { uuid: string }) {
  const model = useNodeCardModel(uuid);
  const { node } = model;
  const tags = model.node ? model.tags : [];
  return (
    <div className="cupertino-instance-heading">
      <p className="cupertino-breadcrumb">
        服务器 <span>/</span>{" "}
        {regionLabel(node?.region)} <span>/</span>
        <strong>节点详情</strong>
      </p>
      <h1>
        {node?.name || uuid}
        <span className="cupertino-status" data-online={node?.online}>
          {node?.online === true
            ? "在线"
            : node?.online === false
              ? "离线"
              : "待上报"}
        </span>
      </h1>
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
    </div>
  );
}
