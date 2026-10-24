import type { HomeSpeedNode } from "@/services/homeSpeeds";
import { formatDisplayDateTime } from "@/utils/timeDisplay";
import { NetworkDrawer } from "../network/NetworkDrawer";
import { speedText, speedStatus } from "./CarrierSpeeds";
export default function CarrierSpeedDetails({ node, city, timeZone, uuid, admin, onClose }: {
  node: HomeSpeedNode; city: string; timeZone: string; uuid: string; admin: boolean; onClose: () => void;
}) {
  const time = (at: string) => formatDisplayDateTime(Date.parse(at), timeZone, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  return <NetworkDrawer title={`三网测速 · ${city} · IPv${node.family}`} onClose={onClose}>
    <div className="network-form carrier-route-details">
      <p>最近一轮已结束的大陆测速 · P1 单连接。下行流入 VPS，上行流出 VPS；同一轮次、同一地址族展示，不取最高值或拼接旧轮次。</p>
      <p>本轮结束：<time dateTime={node.at}>{time(node.at)}</time></p>
      {node.cities.find(c => c.city === city)?.rows.map(row => <article key={row.carrier}>
        <strong>{row.carrier} · {row.provider || "未配置测量资源"}</strong>
        {(["download", "upload"] as const).map(d => <p key={d}>{d === "download" ? "下行" : "上行"}：{speedText(row[d])}{row[d].bitsPerSecond !== null ? " Mbps" : ""} · {speedStatus(row[d])}</p>)}
        {row.at && <small>测量结束：{time(row.at)}</small>}
      </article>)}
      <p>TCP 已确认字节与本地写入估算均不等于远端应用接收量。缺测、失败及达到流量预算的部分样本以本轮状态展示。</p>
      {admin && <a href={`/instance/${encodeURIComponent(uuid)}?focus=network&tab=speed&round=${encodeURIComponent(node.reportId)}`}>查看本轮完整测速报告</a>}
    </div>
  </NetworkDrawer>;
}
