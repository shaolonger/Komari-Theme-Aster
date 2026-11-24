import { memo, useId, useState, type ComponentProps } from "react";
import { NetworkSummary } from "@/components/aurora/AuroraNodeCard";
import { useHomeRoutes } from "@/hooks/useHomeRoutes";
import { IP_PROVIDERS, MEDIA_SERVICES, RISK_PROVIDERS, dbIpRisk, ipKinds, mediaStatuses, riskPresentation, riskValue, type HomeDiagnosticNode } from "@/services/homeDiagnostics";
import { formatDisplayDateTime } from "@/utils/timeDisplay";

const QUOTA_SEGMENTS = 35;
type Family = "4" | "6";
const FAMILIES = ["4", "6"] as const;

export function CrystalSegments({ percent }: { percent: number }) {
  const fill = Math.min(QUOTA_SEGMENTS, Math.round(QUOTA_SEGMENTS * percent / 100));
  return (
    <div className="crystal-quota-track" aria-hidden="true">
      {Array.from({ length: QUOTA_SEGMENTS }, (_, index) => <i key={index} data-filled={index < fill} />)}
    </div>
  );
}

export const CrystalTrafficReset = memo(function CrystalTrafficReset({ uuid }: { uuid: string }) {
  const { data, displayTimeZone } = useHomeRoutes();
  const cycle = data?.diagnostics?.[uuid]?.["traffic-reset"];
  if (cycle === undefined) return null;
  const valid = cycle && cycle.nextAt > Date.now() && cycle.elapsed < cycle.total;
  const percent = valid ? Math.round(100 * cycle.elapsed / cycle.total) : 0;
  return (
    <section className="crystal-quota crystal-panel" aria-label="周期消耗">
      <div className="crystal-quota-labels">
        <span>周期消耗 {valid && <b>{percent}%</b>}</span>
        {valid ? <small title={`${cycle.total} 天周期 · 每月第 ${cycle.day} 日 · 下次重置 ${formatDisplayDateTime(cycle.nextAt, displayTimeZone)}`}>
          已过 {cycle.elapsed} 天 / 剩余 {cycle.total - cycle.elapsed} 天
        </small> : <small>暂无重置周期</small>}
      </div>
      {valid && <CrystalSegments percent={percent} />}
    </section>
  );
});

function IpQuality({ snapshot, family, timeZone }: {
  snapshot: NonNullable<HomeDiagnosticNode["ip-quality"]>[Family]; family: Family; timeZone: string;
}) {
  const providers = snapshot?.providers;
  const fields = [["usage", "使用类型"], ["company", "公司类型"]] as const;
  return (
    <div title={snapshot ? `IP 质量检测 ${formatDisplayDateTime(Date.parse(snapshot.at), timeZone)}` : undefined}>
      {snapshot?.state === "failed" ? <p className="crystal-diagnostic-empty">最近检测未取得 IP 质量结果</p> : providers ? <>
        <table className="crystal-diagnostic-table" aria-label={`IPv${family} IP 质量`}>
          <thead><tr><td />{IP_PROVIDERS.map(name => <th key={name} scope="col">{name}</th>)}</tr></thead>
          <tbody>{fields.map(([field, label]) => (
            <tr key={field}>
              <th scope="row">{label}</th>
              {IP_PROVIDERS.map(name => {
                const type = providers[name]?.[field];
                const tone = type === "business" ? "business"
                  : type === "hosting" || type === "cdn" ? "bad"
                  : type === "isp" || type === "line-isp" || type === "mobile-isp" ? "good"
                  : "neutral";
                return <td key={name}><span className="crystal-diagnostic-badge" data-tone={tone}>{type ? ipKinds[type] : "—"}</span></td>;
              })}
            </tr>
          ))}</tbody>
        </table>
        <section className="crystal-risk" aria-label="风险评分">
          <div className="crystal-risk-heading"><strong>风险评分</strong><small>4 个数据库</small></div>
          <ul className="crystal-risk-list">
            {RISK_PROVIDERS.map(name => {
              const value = riskValue(name, snapshot?.riskScores, providers);
              const { label, tone } = riskPresentation(name, value);
              return <li key={name}>
                <strong>{name}</strong>
                <span className="crystal-diagnostic-badge" data-tone={tone}><b>{value ?? "—"}</b><small>{label}</small></span>
              </li>;
            })}
          </ul>
        </section>
        {snapshot?.ipMode === "lite" && <p className="crystal-diagnostic-empty">
          IPQuality Lite{snapshot.dbIpScore !== undefined && <> · DB-IP {snapshot.dbIpScore} · {dbIpRisk[snapshot.dbIpScore]}</>}
        </p>}
      </> : <p className="crystal-diagnostic-empty">暂无 IPv{family} IP 质量结果</p>}
    </div>
  );
}

function MediaUnlock({ snapshot, family, timeZone }: {
  snapshot: NonNullable<HomeDiagnosticNode["media-unlock"]>[Family]; family: Family; timeZone: string;
}) {
  const services = snapshot?.services;
  return (
    <section className="crystal-capability-unlock" aria-label="解锁"
      title={snapshot ? `解锁检测 ${formatDisplayDateTime(Date.parse(snapshot.at), timeZone)}` : undefined}>
      {snapshot?.state === "failed" ? <p className="crystal-diagnostic-empty">最近检测未取得解锁结果</p> : services ? (
        <ul className="crystal-unlock-list">
          {(Object.entries(MEDIA_SERVICES) as [keyof typeof MEDIA_SERVICES, string][]).map(([key, label]) => {
            const row = services[key];
            const tone = row?.status === "unlocked" ? "good" : row?.status === "blocked" ? "bad" : row?.status === "partial" ? "warn" : "neutral";
            return <li key={key}>
              <strong title={key === "AmazonPrimeVideo" ? "Amazon Prime Video" : undefined}>{key === "AmazonPrimeVideo" ? "AmazonPV" : label}</strong>
              <span className="crystal-diagnostic-badge" data-tone={tone}>{row ? mediaStatuses[row.status] : "暂无"}</span>
              {(row?.region || row?.mode) && <span className="crystal-unlock-tags">
                {row.region && <span>{row.region}</span>}
                {row.mode && <span data-mode={row.mode}>{row.mode === "native" ? "原生" : "DNS"}</span>}
              </span>}
            </li>;
          })}
        </ul>
      ) : <p className="crystal-diagnostic-empty">暂无 IPv{family} 解锁结果</p>}
    </section>
  );
}

export const CrystalNetwork = memo(function CrystalNetwork({ uuid, ping, denseView }: Pick<
  ComponentProps<typeof NetworkSummary>, "uuid" | "ping" | "denseView"
>) {
  const { data, displayTimeZone } = useHomeRoutes();
  const panelId = useId();
  const [expanded, setExpanded] = useState(true);
  const [chosen, select] = useState<Family>();
  const node = data?.diagnostics?.[uuid];
  const ip = node?.["ip-quality"], media = node?.["media-unlock"];
  const hasDiagnostics = Boolean(ip || media);
  const family = chosen ?? (ip?.["4"] || media?.["4"] || !(ip?.["6"] || media?.["6"]) ? "4" : "6");
  const action = hasDiagnostics && (
    <button type="button" className="crystal-ip-toggle" aria-expanded={expanded} aria-controls={panelId}
      onClick={() => setExpanded(value => !value)}>IP能力</button>
  );
  return (
    <>
      <NetworkSummary uuid={uuid} ping={ping} mode="standard" denseView={denseView} crystal crystalAction={action} />
      {hasDiagnostics && (
        <section id={panelId} className="crystal-panel crystal-diagnostic" aria-label="IP能力" hidden={!expanded}>
          <header className="crystal-diagnostic-header">
            <h3>IP能力</h3>
            <div className="crystal-family-tabs" role="group" aria-label="IP能力地址族">
              {FAMILIES.map(value => <button key={value} type="button" aria-pressed={family === value} onClick={() => select(value)}>IPv{value}</button>)}
            </div>
          </header>
          {ip && <IpQuality snapshot={ip[family]} family={family} timeZone={displayTimeZone} />}
          {media && <MediaUnlock snapshot={media[family]} family={family} timeZone={displayTimeZone} />}
        </section>
      )}
    </>
  );
});
