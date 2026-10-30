import { useLayoutEffect } from "react";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { Flag } from "@/components/ui/Flag";
import { formatUptimeDays } from "@/utils/format";
import { regionLabel } from "@/components/glacier/regionLabel";
import { instanceViews, type InstanceView } from "@/utils/instanceView";
import LuminousScene from "./LuminousScene";
export default function LuminousInstanceHeading({
  uuid,
  view,
}: {
  uuid: string;
  view: InstanceView;
}) {
  const model = useNodeCardModel(uuid);
  const node = model.node;
  const tags = model.node ? model.tags : [];
  const ping = view === "ping";
  const title = instanceViews.find((item) => item.id === view)!;
  const uptime = formatUptimeDays(node?.uptime ?? 0);
  useLayoutEffect(() => {
    document.documentElement.dataset.luminousPage = "instance";
    document.documentElement.dataset.luminousView = view;
    return () => {
      delete document.documentElement.dataset.luminousView;
    };
  }, [view]);
  return (
    <div className="luminous-instance-heading">
      <LuminousScene variant={view === "load" ? "server" : "network"} />
      <div className="luminous-instance-title">
        <p>
          ‹ 节点 /{" "}
          {view !== "load" ? (
            <>
              <span>{node?.name || uuid}</span> / {title.label}
            </>
          ) : (
            <> {regionLabel(node?.region)} / 详情</>
          )}
        </p>
        <h1>
          {view === "load" ? node?.name || uuid : title.title}
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
        {view === "load" ? (
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
          <p className="luminous-instance-subtitle">{title.description}</p>
        )}
      </div>
      {view !== "load" && (
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
      {view === "load" && (
        <>
          <div className="luminous-hero-flag" aria-hidden="true">
            <Flag region={node?.region} size={47} />
          </div>
          <div className="luminous-hero-node-placard" aria-hidden="true">
            {node?.name}
          </div>
        </>
      )}
    </div>
  );
}
