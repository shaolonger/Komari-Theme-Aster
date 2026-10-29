import { regionLabel } from "./regionLabel";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";

export default function GlacierInstanceHeading({
  uuid,
  ping,
}: {
  uuid: string;
  ping: boolean;
}) {
  const model = useNodeCardModel(uuid);
  const node = model.node;
  return (
    <div className="glacier-instance-title">
      <div>
        <h1>{ping ? "网络诊断" : node?.name || "节点详情"}</h1>
        <p>
          节点 /{" "}
          {ping
            ? `${node?.name || uuid} / Ping`
            : `${regionLabel(node?.region)} / 详情`}
        </p>
      </div>
      {!ping && node && (
        <span className="glacier-status-badge" data-online={node.online}>
          <i className="glacier-status-dot" />
          {node.online === true
            ? `在线 · 已运行 ${model.uptime.value}${model.uptime.unit}`
            : node.online === false
              ? "离线"
              : "等待上报"}
        </span>
      )}
    </div>
  );
}
