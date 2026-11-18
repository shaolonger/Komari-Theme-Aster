import { memo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  ChartNoAxesColumnIncreasing,
  CircleDollarSign,
  Cpu,
  Database,
  Gauge,
  Globe,
  HardDrive,
  MemoryStick,
} from "lucide-react";
import { NetworkSummary } from "@/components/aurora/AuroraNodeCard";
import { Flag } from "@/components/ui/Flag";
import { OsLogo } from "@/components/ui/OsLogo";
import {
  toggleLuminousFavorite,
  useLuminousFavorites,
} from "@/hooks/useLuminousFavorites";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { formatBytes } from "@/utils/format";
import "@/styles/aurora.css";
import "@/styles/cupertino-dense.css";

function Segments({ value, label }: { value: number; label: string }) {
  const fill = Math.min(100, Math.max(0, value));
  return (
    <div
      className="dense-segments"
      aria-hidden="true"
      title={label}
      style={{ "--fill": `${fill}%` } as CSSProperties}
    />
  );
}

export default memo(function CupertinoDenseCard({ uuid }: { uuid: string }) {
  const model = useNodeCardModel(uuid);
  const favorite = useLuminousFavorites().includes(uuid);
  const [copied, setCopied] = useState("");
  if (!model.node) return <article className="cupertino-dense-card" aria-busy="true" />;

  const { node, uptime, expire, renewalPrice, traffic, upRate, downRate, tags } = model;
  const known = node.updatedAt > 0;
  const online = node.online === true;
  const detailUrl = `/instance/${encodeURIComponent(uuid)}`;
  const status = online
    ? uptime.unit ? `在线 ${uptime.value} ${uptime.unit}` : "在线"
    : node.online === false ? "离线" : "待上报";
  const role = node.business_role?.trim() || node.group?.trim();
  const captions = [role, ...tags.map(({ label }) => label), node.group, node.provider];
  const labels = [...new Set(captions.map((label) => label?.trim()).filter(Boolean))];
  const resources = [
    [
      Cpu, "CPU",
      known ? `${node.cpuPct.toFixed(node.cpuPct < 100 ? 1 : 0)}%` : "—",
      node.cpuPct, `${node.cpu_cores || "—"} 核`,
    ],
    [
      MemoryStick, "内存",
      known ? `${Math.round(node.ramPct)}%` : "—", node.ramPct,
      `${known ? formatBytes(node.ramUsed) : "—"} / ${formatBytes(node.ramTotal)}`,
    ],
    [
      HardDrive, "磁盘",
      known ? `${Math.round(node.diskPct)}%` : "—", node.diskPct,
      `${known ? formatBytes(node.diskUsed) : "—"} / ${formatBytes(node.diskTotal)}`,
    ],
    [
      Gauge, "负载",
      known ? node.load1.toFixed(2) : "—", model.loadFraction * 100,
      `5 分钟 ${known ? node.load5.toFixed(2) : "—"}`,
    ],
  ] as const;
  const expiry = expire.unit ? `余 ${expire.value} ${expire.unit}` : expire.value;
  const limited = node.traffic_limit > 0;
  const totalUp = known ? formatBytes(node.trafficUp, 1) : "—";
  const totalDown = known ? formatBytes(node.trafficDown, 1) : "—";
  const [upValue, upUnit] = totalUp.split(" ");
  const [downValue, downUnit] = totalDown.split(" ");
  const copy = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied("已复制");
    } catch {
      setCopied("复制失败");
    }
  };

  return (
    <article className="aurora-node-card cupertino-dense-card" data-node={uuid}>
      <header className="dense-card-header">
        <Flag region={node.region} size={14} />
        <Link to={detailUrl} className="dense-node-name" title={node.name}>{node.name}</Link>
        <details className="dense-node-actions" onToggle={(event) => {
          if (!event.currentTarget.open) setCopied("");
        }}>
          <summary aria-label={`${node.name} 节点操作`} title="节点操作">
            <Globe />
          </summary>
          <div className="dense-node-menu">
            <Link to={detailUrl}>节点详情</Link>
            <Link to={`${detailUrl}?focus=ping`}>网络监控</Link>
            <Link to={`${detailUrl}/report`}>生成报告</Link>
            <button type="button" aria-pressed={favorite} onClick={() => toggleLuminousFavorite(uuid)}>
              {favorite ? "取消收藏" : "收藏节点"}
            </button>
            {([["IPv4", node.ipv4], ["IPv6", node.ipv6]] as const).map(([family, address]) => address && (
              <button type="button" key={family} onClick={() => void copy(address)} title={address}>
                复制 {family} · {address}
              </button>
            ))}
            {copied && <small role="status">{copied}</small>}
          </div>
        </details>
        <Link to={`${detailUrl}?focus=load`} aria-label={`${node.name} 性能趋势`} title="性能趋势">
          <ChartNoAxesColumnIncreasing />
        </Link>
        <OsLogo value={node.os} size={15} />
      </header>

      <div className="dense-card-labels">
        {labels.map((label) => (
          <span className="dense-tag" key={label} data-group={label === role} title={label}>
            {label}
          </span>
        ))}
        <span className="dense-status" data-online={node.online} title={node.public_remark || status}>{status}</span>
      </div>

      <div className="dense-resources">
        {resources.map(([Icon, label, value, fill, detail]) => (
          <div key={label}>
            <div className="dense-resource-value">
              <Icon />
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
            <Segments value={known ? fill : 0} label={`${label} ${value}`} />
            <small title={detail}>{detail}</small>
          </div>
        ))}
      </div>

      <div className="dense-network-stats">
        <div className="dense-live-rates">
          <span title={`实时上行 ${online ? upRate.value + upRate.unit : "—"}`}>
            <ArrowUp /><strong>{online ? upRate.value : "—"}{online && <small>{upRate.unit}</small>}</strong>
          </span>
          <span title={`实时下行 ${online ? downRate.value + downRate.unit : "—"}`}>
            <ArrowDown /><strong>{online ? downRate.value : "—"}{online && <small>{downRate.unit}</small>}</strong>
          </span>
        </div>
        <div>
          <span title={`累计上行 ${totalUp}`}>
            <ArrowUp /><strong>{upValue}{upUnit && <small>{upUnit}</small>}</strong>
          </span>
          <span title={`累计下行 ${totalDown}`}>
            <ArrowDown /><strong>{downValue}{downUnit && <small>{downUnit}</small>}</strong>
          </span>
        </div>
        <div className="dense-billing">
          <span title={node.expired_at || "到期时间未设置"}>
            <CalendarClock /><strong>{expiry}</strong>
          </span>
          <span title={renewalPrice || "续费未填写"}>
            <CircleDollarSign /><strong>{renewalPrice || "—"}</strong>
          </span>
        </div>
        <div className="dense-connections">
          <span title={`TCP ${known ? node.connectionsTcp : "—"}`}>TCP <strong>{known ? node.connectionsTcp : "—"}</strong></span>
          <span title={`UDP ${known ? node.connectionsUdp : "—"}`}>UDP <strong>{known ? node.connectionsUdp : "—"}</strong></span>
        </div>
      </div>

      <div className="dense-quota">
        <span title={known ? `已用 / 配额 ${traffic.detail}` : "流量尚未上报"}>
          <Database />剩余 <strong>{known || !limited ? traffic.remainingLabel : "—"}</strong>
          / {limited ? formatBytes(node.traffic_limit) : "∞"}
        </span>
        <small>{limited ? traffic.typeLabel : "不限量"}</small>
      </div>
      <div className="dense-quota-track">
        <Segments
          value={known ? traffic.fraction * 100 : 0}
          label={limited && known ? `已用流量 ${(traffic.fraction * 100).toFixed(1)}%` : traffic.typeLabel}
        />
      </div>
      <NetworkSummary ping={model.ping} uuid={uuid} mode="standard" dense />
    </article>
  );
});
