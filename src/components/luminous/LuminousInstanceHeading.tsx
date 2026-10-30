import { useLayoutEffect } from "react";
import { Clock3 } from "lucide-react";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { Flag } from "@/components/ui/Flag";
import { formatUptimeDays } from "@/utils/format";
import { formatDisplayDateTime } from "@/utils/timeDisplay";
import { regionLabel } from "@/components/glacier/regionLabel";
import LuminousScene from "./LuminousScene";
export default function LuminousInstanceHeading({
  uuid,
  ping,
}: {
  uuid: string;
  ping: boolean;
}) {
  const model = useNodeCardModel(uuid);
  const node = model.node;
  const tags = model.node ? model.tags : [];
  const settings = useThemeSettings();
  const uptime = formatUptimeDays(node?.uptime ?? 0);
  useLayoutEffect(() => {
    document.documentElement.dataset.luminousPage = ping ? "ping" : "instance";
  }, [ping]);
  return (
    <div className="luminous-instance-heading">
      <LuminousScene variant={ping ? "network" : "server"} />
      <div className="luminous-instance-title">
        <p>
          ‹ 节点 /{" "}
          {ping ? (
            <>
              <span>{node?.name || uuid}</span> / Ping
            </>
          ) : (
            <> {regionLabel(node?.region)} / 详情</>
          )}
        </p>
        <h1>
          {ping ? "网络诊断" : node?.name || uuid}
          {!ping && (
            <small data-online={node?.online}>
              <i />
              {node?.online === true
                ? "在线"
                : node?.online === false
                  ? "离线"
                  : "待上报"}
            </small>
          )}
        </h1>
        {!ping ? (
          <div className="luminous-instance-tags">
            <span>
              <Flag region={node?.region} size={19} />
              {node?.region} · {regionLabel(node?.region)}
            </span>
            <span className="is-uptime">
              ◆ {node?.online === true ? "在线" : "运行"} {uptime.value}
              {uptime.unit}
            </span>
            {tags?.slice(0, 2).map((tag, i) => (
              <span data-tag={i} key={i}>
                {tag.label}
              </span>
            ))}
            {node?.os && <span data-os="true">◷ {node.os}</span>}
          </div>
        ) : (
          <p className="luminous-instance-subtitle">
            实时检测节点网络质量，分析延迟、丢包与线路稳定性
          </p>
        )}
      </div>
      {ping && (
        <div
          className="luminous-network-node-label luminous-glass"
          aria-hidden="true"
        >
          <Flag region={node?.region} size={22} />
          <span>
            <strong>{node?.name || uuid}</strong>
            <small>
              {node?.online === true
                ? "在线"
                : node?.online === false
                  ? "离线"
                  : "待上报"}{" "}
              · {uptime.value}
              {uptime.unit}
            </small>
          </span>
        </div>
      )}
      {!ping && (
        <>
          <div className="luminous-hero-flag" aria-hidden="true">
            <Flag region={node?.region} size={47} />
          </div>
          <div className="luminous-hero-node-placard" aria-hidden="true">
            {node?.name}
          </div>
          <div className="luminous-uptime luminous-glass">
            <Clock3 />
            <span>
              <small>运行时长</small>
              <strong>
                {uptime.value} {uptime.unit}
              </strong>
              <small>
                {node?.created_at
                  ? formatDisplayDateTime(
                      Date.parse(node.created_at),
                      settings.displayTimeZone,
                      { year: "numeric", month: "2-digit", day: "2-digit" },
                    ) + " 创建"
                  : "Agent 持续运行"}
              </small>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
