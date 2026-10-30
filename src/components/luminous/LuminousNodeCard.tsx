import { memo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Ellipsis, Star } from "lucide-react";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import {
  useLuminousFavorites,
  toggleLuminousFavorite,
} from "@/hooks/useLuminousFavorites";
import { Flag } from "@/components/ui/Flag";
import { OsLogo } from "@/components/ui/OsLogo";
import { NodeCard } from "@/components/node/NodeCard";
import { TrafficSparkline } from "@/components/node/TrafficSparkline";
import { buildHomepagePingSourceRows } from "@/utils/homepagePingSources";
import { formatMetricNumber } from "@/utils/format";
import { getDisplayRegionCode } from "@/utils/geo";
import ServerSculpture from "./ServerSculpture";

export default memo(function LuminousNodeCard({ uuid }: { uuid: string }) {
  const model = useNodeCardModel(uuid);
  const settings = useThemeSettings();
  const favorites = useLuminousFavorites();
  const [expanded, setExpanded] = useState(false);
  if (!model.node)
    return (
      <article
        className="luminous-reference-card server-card"
        aria-busy="true"
      />
    );
  const { node, traffic, trafficTrend, upRate, downRate, expire } = model;
  const rows = buildHomepagePingSourceRows(
    model.ping,
    settings.homepagePingTaskGroups,
    settings.homepagePingTaskOrder[uuid],
  );
  const bad = model.isOffline || rows.some((row) => row.status === "critical");
  const favorite = favorites.includes(uuid);
  const gauges = [
    { label: "CPU", value: node.cpuPct, color: "#1687ff" },
    { label: "内存", value: node.ramPct, color: "#8851ff" },
    { label: "磁盘", value: node.diskPct, color: "#ffb120" },
  ];
  return (
    <article
      className={
        "luminous-reference-card server-card" +
        (model.isOffline ? " is-offline" : "")
      }
      data-status={bad ? "critical" : "ok"}
      data-expanded={expanded}
    >
      <header className="luminous-card-heading">
        <Link to={"/instance/" + uuid} className="luminous-card-identity">
          {/mac|darwin|windows/i.test(node.os) ? (
            <OsLogo value={node.os} size={20} />
          ) : (
            <Flag region={node.region} size={18} />
          )}
          <strong title={node.name}>{node.name}</strong>
        </Link>
        <span
          className="luminous-node-online"
          data-online={node.online}
          data-critical={bad}
        >
          {node.online === true
            ? bad
              ? "异常"
              : "在线"
            : node.online === false
              ? "离线"
              : "待上报"}
        </span>
        <button
          className="luminous-card-favorite"
          data-favorite={favorite}
          aria-label={(favorite ? "取消收藏 " : "收藏 ") + node.name}
          aria-pressed={favorite}
          onClick={() => toggleLuminousFavorite(uuid)}
        >
          <Star size={15} fill={favorite ? "currentColor" : "none"} />
        </button>
        <button
          className="luminous-card-expand"
          aria-label={(expanded ? "收起" : "展开") + "完整指标 " + node.name}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <Ellipsis size={15} />
        </button>
      </header>
      <div className="luminous-card-tags">
        <span>{getDisplayRegionCode(node.region)}</span>
        {node.ipv4 && <span data-kind="ip">V4</span>}
        {node.ipv6 && <span data-kind="ip">V6</span>}
        {(model.tags ?? []).slice(0, 2).map((tag, i) => (
          <span key={i} data-kind="tag" title="节点标注">
            {tag.label}
          </span>
        ))}
      </div>
      <div className="luminous-card-resources">
        <ServerSculpture
          small
          tone={
            bad
              ? "red"
              : uuid.charCodeAt(uuid.length - 1) % 3 === 0
                ? "purple"
                : "blue"
          }
        />
        <div className="luminous-card-gauges">
          {gauges.map((gauge) => (
            <div
              key={gauge.label}
              className="luminous-card-gauge"
              style={
                {
                  "--gauge-value":
                    Math.max(0, Math.min(100, gauge.value)) + "%",
                  "--gauge-tint": gauge.value >= 85 ? "#ff4665" : gauge.color,
                } as CSSProperties
              }
            >
              <small>{gauge.label}</small>
              <span>
                <b>{formatMetricNumber(gauge.value, { digits: 1 })}%</b>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="luminous-card-network">
        <div className="luminous-card-traffic">
          <TrafficSparkline
            samples={trafficTrend.up}
            color={bad ? "#ff4d69" : "#00bc83"}
            height={32}
          />
        </div>
        <div className="luminous-card-rates">
          <p>
            <ArrowUp size={10} />
            {upRate.value} {upRate.unit}
            <ArrowDown size={10} />
            {downRate.value} {downRate.unit}
          </p>
          <strong style={{ color: bad ? "#ef3d63" : "#4476ed" }}>
            {traffic.detail}
          </strong>
        </div>
      </div>
      <div
        className="luminous-card-quota"
        title={traffic.typeLabel}
        style={
          {
            "--quota-fill":
              Math.max(0, Math.min(100, traffic.fraction * 100)) + "%",
            "--quota-color": bad ? "#ff4d69" : traffic.color,
          } as CSSProperties
        }
      >
        <i />
      </div>
      <footer className="luminous-card-ping">
        <div>
          <small>续费期限</small>
          <span title={model.renewalPrice || "续费未填写"}>
            {expire.value}
            {expire.unit}
            {expire.unit ? "后到期" : ""}
          </span>
        </div>
        {rows.length ? (
          rows.slice(0, 3).map((row) => (
            <Link key={row.taskId} to={"/instance/" + uuid + "?focus=ping"}>
              <small title={row.name}>{row.name}</small>
              <b data-status={row.status}>
                {row.lossPercent != null && row.lossPercent >= 100
                  ? "100% 丢包"
                  : row.latencyMs == null
                    ? "—"
                    : row.latencyShortLabel + " ms"}
              </b>
            </Link>
          ))
        ) : (
          <Link
            className="luminous-card-no-ping"
            to={"/instance/" + uuid + "?focus=ping"}
          >
            暂无可用延迟观测
          </Link>
        )}
      </footer>
      {expanded && (
        <div
          className="luminous-expanded-card"
          aria-label={node.name + "完整指标"}
        >
          <NodeCard uuid={uuid} density="expanded" />
        </div>
      )}
    </article>
  );
});
