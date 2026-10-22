import { z } from "zod";
import type { RouteEvidence } from "@/services/homeRoutes";
import { formatDisplayDateTime } from "@/utils/timeDisplay";
import { NetworkDrawer } from "../network/NetworkDrawer";

const observationSchema = z.object({ label: z.string(), at: z.string().datetime(), city: z.string(),
  provider: z.string(), protocol: z.string(), asPath: z.array(z.string()).max(64), state: z.string() });

export default function RouteEvidenceDetails({ value, direction, status, timeZone, onClose }: {
  value: RouteEvidence | null; direction: string; status: string; timeZone: string; onClose: () => void;
}) {
  const observations = (value?.observations || []).flatMap(raw => { const parsed = observationSchema.safeParse(raw); return parsed.success ? [parsed.data] : []; });
  return <NetworkDrawer title={direction} onClose={onClose}>
    <div className="network-form carrier-route-details">
      <strong>{value?.label || "尚无观测"}</strong>
      <p>{status}。线路名称表示观测网络；CN2 GIA、CTG GIA 等商业产品未由路径认证。</p>
      {value && <p>本轮 {value.samples} 组观测{(value.variants || 0) > 1 ? "，不同测量的网络证据存在差异" : ""}。ASN 集合（最多 64 项）：{value.asns.map(a => "AS" + a).join("、") || "未取得"}。</p>}
      {value && value.samples > observations.length && <p>此卡片展示 {observations.length}/{value.samples} 组摘要，完整路径保存在对应轮次报告中。</p>}
      {value?.diagnostic && <p>{value.diagnostic}</p>}
      {observations.map((observation, i) => <article key={i}>
        <strong>{observation.city} · {observation.provider} · {observation.protocol.toUpperCase()}</strong>
        <p>{observation.label} · {observation.state === "ok" ? "终点已确认" : observation.state === "partial" ? "终点未确认" : "无有效路径"}</p>
        <p>{observation.asPath.map(asn => asn === "?" ? "未知" : "AS" + asn).join(" → ") || "无 ASN 序列"}</p>
        <small>{formatDisplayDateTime(Date.parse(observation.at), timeZone, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</small>
      </article>)}
    </div>
  </NetworkDrawer>;
}
