import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { Flag } from "@/components/ui/Flag";
import { formatBytes } from "@/utils/format";
import { regionLabel } from "@/components/glacier/regionLabel";
export default function OrbitalInstanceHeading({
  uuid,
  ping,
}: {
  uuid: string;
  ping: boolean;
}) {
  const { node } = useNodeCardModel(uuid);
  return (
    <div className="orbital-instance-heading">
      <p>
        节点 / {regionLabel(node?.region)} / {ping ? "网络诊断" : "实例详情"}
      </p>
      <h1>
        {node?.name || uuid}
        {ping && <span> / 网络诊断</span>}
        <small data-online={node?.online}>
          <i />
          {node?.online === true
            ? "在线"
            : node?.online === false
              ? "离线"
              : "待上报"}
        </small>
        {node?.region && <Flag region={node.region} size={22} />}
      </h1>
      <div>
        {node
          ? [
              node.os,
              node.virtualization,
              `${node.cpu_cores} vCPU / ${formatBytes(node.ramTotal)}`,
              node.ipv4 || node.ipv6 || "IP 未公开",
            ].join(" · ")
          : "正在读取节点信息…"}
      </div>
    </div>
  );
}
