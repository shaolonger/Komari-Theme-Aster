import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { Flag } from "@/components/ui/Flag";
import { formatBytes } from "@/utils/format";
import { regionLabel } from "@/components/glacier/regionLabel";
import LuminousScene from "./LuminousScene";
export default function LuminousInstanceHeading({
  uuid,
  ping,
}: {
  uuid: string;
  ping: boolean;
}) {
  const { node } = useNodeCardModel(uuid);
  return (
    <div className="luminous-instance-heading">
      <LuminousScene variant={ping ? "network" : "server"} />
      <div className="luminous-instance-title">
        <p>
          节点 / {regionLabel(node?.region)} / {ping ? "Ping" : "详情"}
        </p>
        <h1>
          {ping ? "网络诊断" : node?.name || uuid}
          <small data-online={node?.online}>
            <i />
            {node?.online === true
              ? "在线"
              : node?.online === false
                ? "离线"
                : "待上报"}
          </small>
        </h1>
        {ping && <h2>{node?.name || uuid}</h2>}
        <div>
          {node?.region && <Flag region={node.region} size={20} />}
          <span>
            {node
              ? [
                  node.os,
                  node.virtualization,
                  node.cpu_cores + " vCPU",
                  formatBytes(node.ramTotal),
                  node.ipv4 || node.ipv6 || "IP 未公开",
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "正在读取节点信息…"}
          </span>
        </div>
        <p className="luminous-instance-subtitle">
          {ping
            ? "实时检测节点网络质量，分析延迟、丢包与线路稳定性"
            : "连接每一处云端，掌握每一刻变化"}
        </p>
      </div>
    </div>
  );
}
