import { memo, useState, type ReactNode } from "react";
import { Layers3, Play } from "lucide-react";
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
    <section className="crystal-quota crystal-panel" aria-label="流量重置">
      <div className="crystal-quota-labels">
        <span>流量重置 {valid && <b>{percent}%</b>}</span>
        {valid ? <small title={`每月第 ${cycle.day} 日 · 下次重置 ${formatDisplayDateTime(cycle.nextAt, displayTimeZone)}`}>
          已过 {cycle.elapsed} 天 / 剩余 {cycle.total - cycle.elapsed} 天（{cycle.total} 天周期）
        </small> : <small>暂无重置周期</small>}
      </div>
      {valid && <CrystalSegments percent={percent} />}
    </section>
  );
});

function DiagnosticPanel({ label, icon, family, select, title, children }: {
  label: string; icon: ReactNode; family: Family; select: (family: Family) => void; title: string; children: ReactNode;
}) {
  return (
    <section className="crystal-panel crystal-diagnostic" aria-label={label}>
      <header className="crystal-diagnostic-header">
        <h3 title={title}><span>{icon}</span>{label}</h3>
        <div className="crystal-family-tabs" role="group" aria-label={`${label} 地址族`}>
          {FAMILIES.map(value => <button key={value} type="button" aria-pressed={family === value} onClick={() => select(value)}>IPv{value}</button>)}
        </div>
      </header>
      {children}
    </section>
  );
}

function IpQuality({ results, timeZone }: { results: NonNullable<HomeDiagnosticNode["ip-quality"]>; timeZone: string }) {
  const [chosen, select] = useState<Family>();
  const family = chosen ?? (results["4"] || !results["6"] ? "4" : "6");
  const snapshot = results[family];
  const providers = snapshot?.providers;
  const fields = [["usage", "使用类型"], ["company", "公司类型"]] as const;
  return (
    <DiagnosticPanel label="IP" icon={<Layers3 aria-hidden="true" />} family={family} select={select}
      title={snapshot ? `最近检测 ${formatDisplayDateTime(Date.parse(snapshot.at), timeZone)}` : "暂无检测结果"}>
      {snapshot?.state === "failed" ? <p className="crystal-diagnostic-empty">最近检测未取得 IP 质量结果</p> : providers ? <>
        <table className="crystal-diagnostic-table" aria-label={`IPv${family} IP 质量`}>
          <thead><tr><td />{IP_PROVIDERS.map(name => <th key={name} scope="col">{name}</th>)}</tr></thead>
          <tbody>{fields.map(([field, label]) => (
            <tr key={field}>
              <th scope="row">{label}</th>
              {IP_PROVIDERS.map(name => {
                const type = providers[name]?.[field];
                const tone = type === "hosting" || type === "cdn" ? "bad" : type === "isp" || type === "line-isp" || type === "mobile-isp" ? "good"
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
      </> : <p className="crystal-diagnostic-empty">暂无 IPv{family} 检测结果</p>}
    </DiagnosticPanel>
  );
}

function MediaUnlock({ results, timeZone }: { results: NonNullable<HomeDiagnosticNode["media-unlock"]>; timeZone: string }) {
  const [chosen, select] = useState<Family>();
  const family = chosen ?? (results["4"] || !results["6"] ? "4" : "6");
  const snapshot = results[family];
  const services = snapshot?.services;
  return (
    <DiagnosticPanel label="解锁" icon={<Play aria-hidden="true" />} family={family} select={select}
      title={snapshot ? `最近检测 ${formatDisplayDateTime(Date.parse(snapshot.at), timeZone)}` : "暂无检测结果"}>
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
      ) : <p className="crystal-diagnostic-empty">暂无 IPv{family} 检测结果</p>}
    </DiagnosticPanel>
  );
}

export const CrystalDiagnostics = memo(function CrystalDiagnostics({ uuid }: { uuid: string }) {
  const { data, displayTimeZone } = useHomeRoutes();
  const node = data?.diagnostics?.[uuid];
  if (!node) return null;
  return (
    <>
      {node["ip-quality"] && <IpQuality results={node["ip-quality"]} timeZone={displayTimeZone} />}
      {node["media-unlock"] && <MediaUnlock results={node["media-unlock"]} timeZone={displayTimeZone} />}
    </>
  );
});
