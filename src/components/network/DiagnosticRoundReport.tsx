import {
  IP_PROVIDERS, MEDIA_SERVICES, RISK_PROVIDERS, dbIpRisk, dbIpScoreSchema, ipKinds, ipProvidersSchema,
  mediaEvidenceSchema, mediaServicesSchema, mediaStatuses, riskPresentation, riskScoresSchema, riskValue,
} from "@/services/homeDiagnostics";
import type { ReportRound } from "@/services/reportObservatory";
import { NetworkBadge } from "./NetworkUi";
import { reportLabels } from "./reportMetrics";
import { formatNetworkTime } from "./shared";

const evidenceStatuses = { ...mediaStatuses, failed: "检测失败", unknown: "未能确认" };
const evidenceSources = { ipQuality: "IPQuality", regionRestriction: "RegionRestrictionCheck" } as const;
const mediaNames = Object.keys(MEDIA_SERVICES) as (keyof typeof MEDIA_SERVICES)[];
const modeLabel = (mode?: string) => mode === "native" ? "原生" : mode === "dns" ? "DNS" : "—";

export function DiagnosticRoundReport({ round }: { round: ReportRound }) {
  const ip = round.module === "ip-quality";
  return <div className="report-diagnostic-results">
    {round.slots.map(slot => {
      const result = round.measurements.find(measurement => measurement.slotId === slot.id);
      const data = result?.data || slot.metrics;
      const providers = ipProvidersSchema.safeParse(data?.providers).data;
      const scores = riskScoresSchema.safeParse(data?.riskScores).data;
      const dbIp = dbIpScoreSchema.safeParse(data?.dbIpScore).data;
      const services = mediaServicesSchema.safeParse(data?.services).data;
      const evidence = mediaEvidenceSchema.safeParse(data?.mediaEvidence).data;
      const hasDetails = ip ? providers || scores || dbIp : services || evidence;
      const state = result?.data.state || slot.state;
      const completedAt = result?.completedAt || slot.completedAt;
      const reason = typeof data?.diagnostic === "string" && data.diagnostic || slot.missingReason || slot.waitReason;
      return <section key={slot.id} className="report-diagnostic-family">
        <h4>IPv{slot.options.family === "6" ? "6" : "4"} <NetworkBadge state={state}>{reportLabels[state] || state}</NetworkBadge></h4>
        {completedAt && <p className="report-caption">{formatNetworkTime(completedAt)}</p>}
        {reason && <p>{reason}</p>}
        {!hasDetails && !reason && <p className="report-caption">{round.state === "running" ? "等待探测器返回结果。" : "此地址族暂无检测结果。"}</p>}
        {ip && hasDetails && <>
          <div className="report-table-scroll">
            <table aria-label="IP 类型">
              <thead><tr><th>数据库</th><th>使用类型</th><th>公司类型</th></tr></thead>
              <tbody>{IP_PROVIDERS.map(name => {
                const row = providers?.[name];
                return <tr key={name}><th scope="row">{name}</th><td>{row?.usage ? ipKinds[row.usage] : "—"}</td>
                  <td>{row?.company ? ipKinds[row.company] : "—"}</td></tr>;
              })}</tbody>
            </table>
          </div>
          <div className="report-table-scroll">
            <table aria-label="风险评分">
              <thead><tr><th>数据库</th><th>风险评分</th><th>风险等级</th></tr></thead>
              <tbody>{RISK_PROVIDERS.map(name => {
                const score = riskValue(name, scores, providers);
                return <tr key={name}><th scope="row">{name}</th><td>{score ?? "—"}</td><td>{riskPresentation(name, score).label}</td></tr>;
              })}{dbIp !== undefined && <tr><th scope="row">DB-IP</th><td>{dbIp}</td><td>{dbIpRisk[dbIp]}</td></tr>}</tbody>
            </table>
          </div>
        </>}
        {(services || evidence) && <div className="report-table-scroll">
          <table aria-label="流媒体和 AI 解锁">
            <thead><tr><th>服务</th><th>检测状态</th><th>地区</th><th>解锁方式</th></tr></thead>
            <tbody>{mediaNames.map(name => {
              const row = services?.[name];
              const observation = evidence?.[name];
              return <tr key={name}><th scope="row">{MEDIA_SERVICES[name]}</th>
                <td>{row ? mediaStatuses[row.status] : observation ? "未能确认" : "暂无结果"}</td><td>{row?.region || "—"}</td>
                <td>{modeLabel(row?.mode)}</td></tr>;
            })}</tbody>
          </table>
        </div>}
        {evidence && <details>
          <summary>查看两套脚本的判定</summary>
          <div className="report-table-scroll">
            <table aria-label="解锁判定依据">
              <thead><tr><th>服务</th><th>来源</th><th>状态</th><th>地区</th><th>方式</th></tr></thead>
              <tbody>{mediaNames.flatMap(name => (Object.keys(evidenceSources) as (keyof typeof evidenceSources)[]).map(source => {
                const row = evidence[name]?.[source];
                return row ? <tr key={name + ":" + source}><th scope="row">{MEDIA_SERVICES[name]}</th>
                  <td>{evidenceSources[source]}</td><td>{evidenceStatuses[row.status]}</td>
                  <td>{row.region || "—"}</td><td>{modeLabel(row.mode)}</td></tr> : null;
              }))}</tbody>
            </table>
          </div>
        </details>}
      </section>;
    })}
  </div>;
}
