import { memo, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Ellipsis } from "lucide-react";
import { NetworkSummary } from "@/components/aurora/AuroraNodeCard";
import { Flag } from "@/components/ui/Flag";
import { OsLogo } from "@/components/ui/OsLogo";
import { useLuminousFavorites } from "@/hooks/useLuminousFavorites";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { formatBytes } from "@/utils/format";
import { DenseNodeActions } from "./DenseNodeActions";
import { CrystalDiagnostics, CrystalSegments, CrystalTrafficReset } from "./CrystalDiagnostics";
import "@/styles/aurora.css";
import "@/styles/crystal-card.css";

const MISSING = "--";

export default memo(function CrystalNodeCard({ uuid, compact }: { uuid: string; compact: boolean }) {
  const model = useNodeCardModel(uuid);
  const favorite = useLuminousFavorites().includes(uuid);
  if (!model.node) return <article className="crystal-card" aria-busy="true" />;

  const { node, uptime, expire, renewalPrice, traffic, upRate, downRate, tags } = model;
  const known = node.updatedAt > 0;
  const online = node.online === true;
  const detailUrl = `/instance/${encodeURIComponent(uuid)}`;
  const perfUrl = `${detailUrl}?focus=load`;
  const uptimeHours = uptime.unit === "天" ? Math.floor(node.uptime / 3600) % 24 : 0;
  const status = online
    ? uptime.unit ? `在线 ${uptime.value}${uptime.unit}${uptimeHours ? `${uptimeHours}小时` : ""}` : "在线"
    : node.online === false ? "离线" : "待上报";
  const labels = compact ? [] : [...new Set(
    [node.business_role, ...tags.map(({ label }) => label), node.group, node.provider]
      .map(label => label?.trim())
      .filter(Boolean),
  )];
  const resources = [
    ["cpu", "CPU", `${node.cpuPct.toFixed(1)}%`, node.cpuPct, `${node.cpu_cores || MISSING} 核`],
    ["ram", "内存", `${node.ramPct.toFixed(1)}%`, node.ramPct, `${known ? formatBytes(node.ramUsed) : MISSING} / ${formatBytes(node.ramTotal)}`],
    ["disk", "存储", `${node.diskPct.toFixed(1)}%`, node.diskPct, `${known ? formatBytes(node.diskUsed) : MISSING} / ${formatBytes(node.diskTotal)}`],
    ["load", "负载", node.load1.toFixed(2), model.loadFraction * 100, `5 分钟 ${known ? node.load5.toFixed(2) : MISSING}`],
  ] as const;
  const limited = traffic.usagePercent != null;
  const usedPercent = known && limited ? Math.max(0, traffic.usagePercent ?? 0) : 0;
  const [used, total] = traffic.detail.split(" / ");
  const [upTotal, upUnit] = (known ? formatBytes(node.trafficUp) : MISSING).split(" ");
  const [downTotal, downUnit] = (known ? formatBytes(node.trafficDown) : MISSING).split(" ");
  const renewal = renewalPrice?.replace("/", " / ") || MISSING;

  return (
    <article className="crystal-card" data-node={uuid}>
      <header className="crystal-header">
        <span className="crystal-flag"><Flag region={node.region} size={52} /></span>
        <Link className="crystal-name" to={detailUrl} title={node.name}>{node.name}</Link>
        <span className="crystal-status" data-online={node.online} title={node.public_remark ? `${status} · ${node.public_remark}` : status}>{status}</span>
        <Link className="crystal-os" to={perfUrl} aria-label={`${node.name} 性能趋势`} title={`${model.osName} · 性能趋势`}><OsLogo value={node.os} size={42} /></Link>
        <DenseNodeActions icon={Ellipsis} node={node} detailUrl={detailUrl} favorite={favorite} />
      </header>

      {!compact && labels.length > 0 && (
        <div className="crystal-tags">
          {labels.map(label => <span key={label}>{label}</span>)}
        </div>
      )}

      <section className="crystal-resources crystal-panel" aria-label="资源使用">
        {resources.map(([metric, label, value, fill, detail]) => (
          <Link key={metric} data-metric={metric} to={perfUrl} title={`${label} · ${detail}`}>
            <span className="crystal-resource-value"><span>{label}</span><b>{known ? value : MISSING}</b></span>
            <span className="crystal-resource-track" aria-hidden="true">
              {known && fill > 0 && <i style={{ width: `${Math.min(100, fill)}%` }} />}
            </span>
            {!compact && <small className="crystal-resource-detail">{detail}</small>}
          </Link>
        ))}
      </section>

      <section className="crystal-stats crystal-panel" aria-label="实时速率、累计流量、账单与连接">
        <div className="crystal-live">
          <span data-direction="up" title="实时上行"><ArrowUp aria-hidden="true" /><strong>{online ? upRate.value : MISSING}</strong>{online && <small>{upRate.unit}</small>}</span>
          <span data-direction="down" title="实时下行"><ArrowDown aria-hidden="true" /><strong>{online ? downRate.value : MISSING}</strong>{online && <small>{downRate.unit}</small>}</span>
        </div>
        <div className="crystal-totals">
          <span title="累计上行"><ArrowUp aria-hidden="true" /><strong>{upTotal}</strong>{upUnit && <small>{upUnit}</small>}</span>
          <span title="累计下行"><ArrowDown aria-hidden="true" /><strong>{downTotal}</strong>{downUnit && <small>{downUnit}</small>}</span>
        </div>
        <div className="crystal-billing">
          <span title={node.expired_at || "到期时间未设置"}>剩余 <strong>{expire.value === "—" ? MISSING : expire.value}</strong>{expire.unit && <small>{expire.unit}</small>}</span>
          <span title={renewalPrice || "续费未填写"}>续费 <strong>{renewal}</strong></span>
        </div>
        <div className="crystal-connections">
          <span>TCP <strong>{known ? node.connectionsTcp : MISSING}</strong></span>
          <span>UDP <strong>{known ? node.connectionsUdp : MISSING}</strong></span>
        </div>
      </section>

      <section className="crystal-quota crystal-panel" aria-label="流量使用"
        style={usedPercent >= 70 ? { "--crystal-quota-fill": traffic.color } as CSSProperties : undefined}
      >
        <div className="crystal-quota-labels">
          <span>流量使用 <b>{limited ? known ? `${Math.round(usedPercent)}%` : MISSING : "不限量"}</b></span>
          <small title={limited ? `${traffic.typeLabel} · 剩余 ${known ? traffic.remainingLabel : MISSING}` : undefined}>已用 {known ? used : MISSING} / 总计 {total}</small>
        </div>
        <CrystalSegments percent={usedPercent} />
      </section>
      <CrystalTrafficReset uuid={uuid} />
      <NetworkSummary ping={model.ping} uuid={uuid} mode="standard" denseView={compact ? "compact" : "standard"} crystal />
      <CrystalDiagnostics uuid={uuid} />
    </article>
  );
});
