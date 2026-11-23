import {
  IP_PROVIDERS, MEDIA_SERVICES, RISK_PROVIDERS, ipKinds, ipProvidersSchema, mediaServicesSchema,
  mediaStatuses, riskPresentation, riskScoresSchema, riskValue,
} from "@/services/homeDiagnostics";
import type { ReportRound } from "@/services/reportObservatory";
import { NetworkBadge } from "./NetworkUi";
import { reportLabels } from "./reportMetrics";
import { formatNetworkTime } from "./shared";

export function DiagnosticRoundReport({ round }: { round: ReportRound }) {
  const ip = round.module === "ip-quality";
  return <div className="report-diagnostic-results">
    {round.slots.map(slot => {
      const result = round.measurements.find(measurement => measurement.slotId === slot.id);
      const data = result?.data || slot.metrics;
      const providers = ipProvidersSchema.safeParse(data?.providers).data;
      const scores = riskScoresSchema.safeParse(data?.riskScores).data;
      const services = mediaServicesSchema.safeParse(data?.services).data;
      const hasDetails = ip ? providers || scores : services;
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
              })}</tbody>
            </table>
          </div>
        </>}
        {services && <div className="report-table-scroll">
          <table aria-label="流媒体和 AI 解锁">
            <thead><tr><th>服务</th><th>检测状态</th><th>地区</th><th>解锁方式</th></tr></thead>
            <tbody>{(Object.keys(MEDIA_SERVICES) as (keyof typeof MEDIA_SERVICES)[]).map(name => {
              const row = services[name];
              return <tr key={name}><th scope="row">{MEDIA_SERVICES[name]}</th>
                <td>{row ? mediaStatuses[row.status] : "未测"}</td><td>{row?.region || "—"}</td>
                <td>{row?.mode === "native" ? "原生" : row?.mode === "dns" ? "DNS" : "—"}</td></tr>;
            })}</tbody>
          </table>
        </div>}
      </section>;
    })}
  </div>;
}
