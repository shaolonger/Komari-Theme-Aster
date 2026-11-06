import { lazy, memo, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  Copy,
  Ellipsis,
  Star,
} from "lucide-react";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import {
  useLuminousFavorites,
  toggleLuminousFavorite,
} from "@/hooks/useLuminousFavorites";
import { Flag } from "@/components/ui/Flag";
import { OsLogo } from "@/components/ui/OsLogo";
import { TrafficSparkline } from "@/components/node/TrafficSparkline";
import { CarrierRoutes } from "@/components/node/LazyCarrierRoutes";
import { CarrierSpeeds } from "@/components/node/LazyCarrierSpeeds";
import { buildHomepagePingSourceRows } from "@/utils/homepagePingSources";
import { formatDisplayDateTime } from "@/utils/timeDisplay";
import { formatBytes, formatMetricPercent } from "@/utils/format";
const FullCard = lazy(() =>
  import("@/components/node/NodeCard").then((m) => ({ default: m.NodeCard })),
);

export default memo(function CupertinoNodeCard({ uuid }: { uuid: string }) {
  const model = useNodeCardModel(uuid),
    settings = useThemeSettings(),
    favorites = useLuminousFavorites();
  const [expanded, setExpanded] = useState(false),
    [copied, setCopied] = useState(false);
  if (!model.node)
    return (
      <article className="cupertino-node-card server-card" aria-busy="true" />
    );
  const { node, traffic, trafficTrend, upRate, downRate, expire, uptime } =
    model;
  const rows = buildHomepagePingSourceRows(
    model.ping,
    settings.homepagePingTaskGroups,
    settings.homepagePingTaskOrder[uuid],
  );
  const address = node.ipv4 || node.ipv6;
  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <article
      className="cupertino-node-card server-card"
      data-online={node.online}
      data-expanded={expanded}
    >
      <header>
        <Link to={"/instance/" + uuid}>
          {/mac|darwin|windows/i.test(node.os) ? (
            <OsLogo value={node.os} size={20} />
          ) : (
            <Flag region={node.region} size={21} />
          )}
          <strong title={node.name}>{node.name}</strong>
        </Link>
        <span className="cupertino-status" data-online={node.online}>
          {node.online === true
            ? "在线"
            : node.online === false
              ? "离线"
              : "待上报"}
        </span>
        <button
          className="cupertino-favorite"
          data-favorite={favorites.includes(uuid)}
          aria-label={
            (favorites.includes(uuid) ? "取消收藏 " : "收藏 ") + node.name
          }
          aria-pressed={favorites.includes(uuid)}
          onClick={() => toggleLuminousFavorite(uuid)}
        >
          <Star
            size={13}
            fill={favorites.includes(uuid) ? "currentColor" : "none"}
          />
        </button>
        <button
          aria-label={(expanded ? "收起" : "展开") + "完整指标 " + node.name}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <Ellipsis size={17} />
        </button>
      </header>
      <div className="cupertino-node-tags">
        <span>{node.region || "未设置地区"}</span>
        {node.group && <span title={node.group}>{node.group}</span>}
        {model.tags?.map((tag, i) => (
          <span key={i} title={tag.label}>
            {tag.label}
          </span>
        ))}
      </div>
      <div className="cupertino-node-address">
        <span title={address || "地址未公开"}>
          IP {address || "未公开"}
          {address && (
            <button
              aria-label={"复制 " + node.name + " IP 地址"}
              onClick={() => void copy()}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
            </button>
          )}
        </span>
        <span title={node.online === false ? "最后上报的缓存数据" : undefined}>
          {node.online === false
            ? "最后上报 " +
              (node.updatedAt
                ? formatDisplayDateTime(
                    node.updatedAt,
                    settings.displayTimeZone,
                    {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    },
                  )
                : "未知")
            : "运行 " + uptime.value + " " + uptime.unit}
        </span>
      </div>
      <div className="cupertino-resource-bars">
        {[
          ["CPU", node.cpuPct],
          ["内存", node.ramPct],
          ["磁盘", node.diskPct],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <i>
              <b
                style={{
                  width: Math.max(0, Math.min(100, Number(value))) + "%",
                }}
              />
            </i>
            <strong>
              {node.online == null ? "—" : formatMetricPercent(Number(value))}
            </strong>
          </div>
        ))}
      </div>
      <div className="cupertino-card-network">
        {node.online === true ? (
          <TrafficSparkline
            samples={trafficTrend.down}
            color="var(--status-success)"
            height={25}
            redrawKey="cupertino"
          />
        ) : (
          <span className="cupertino-offline-spark">—</span>
        )}
        <span>
          <ArrowDown />
          {node.online === true ? downRate.value + " " + downRate.unit : "—"}
          <ArrowUp />
          {node.online === true ? upRate.value + " " + upRate.unit : "—"}
        </span>
      </div>
      <div className="cupertino-card-quota" title={traffic.typeLabel}>
        <span>流量</span>
        <i>
          <b
            style={{
              width: Math.max(0, Math.min(100, traffic.fraction * 100)) + "%",
            }}
          />
        </i>
        <strong>
          {node.updatedAt > 0
            ? traffic.detail
            : "未上报 / " +
              (node.traffic_limit > 0 ? formatBytes(node.traffic_limit) : "∞")}
        </strong>
      </div>
      <div className="cupertino-card-expiry">
        <CalendarDays size={12} />
        <span title={node.expired_at || "到期时间未设置"}>
          {expire.value}
          {expire.unit}
          {expire.unit ? "后到期" : ""}
        </span>
        <span title={model.renewalPrice || "续费未填写"}>
          续费 {model.renewalPrice || "—"}
        </span>
      </div>
      <div className="cupertino-card-pings">
        {rows.length ? (
          rows.map((row) => (
            <Link
              key={row.taskId}
              to={"/instance/" + uuid + "?focus=ping"}
              title={
                row.name +
                " · " +
                (row.lossPercent == null
                  ? "丢包未知"
                  : row.lossPercent + "% 丢包")
              }
            >
              <small>{row.name}</small>
              <span data-status={row.status}>
                <i />
                {row.latencyMs == null
                  ? row.lossPercent === 100
                    ? "100% 丢包"
                    : "—"
                  : row.latencyShortLabel + " ms"}
              </span>
            </Link>
          ))
        ) : (
          <Link
            className="cupertino-ping-empty"
            to={"/instance/" + uuid + "?focus=ping"}
          >
            暂无可用延迟观测
          </Link>
        )}
      </div>
      <CarrierRoutes uuid={uuid} />
      <CarrierSpeeds uuid={uuid} />
      {expanded && (
        <div
          className="cupertino-full-card"
          aria-label={node.name + "完整指标"}
        >
          <Suspense fallback={<p>正在加载完整指标…</p>}>
            <FullCard uuid={uuid} density="expanded" />
          </Suspense>
        </div>
      )}
    </article>
  );
});
