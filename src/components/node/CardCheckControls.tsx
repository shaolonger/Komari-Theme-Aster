import { Check, CircleAlert, RotateCw, Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import { useCardCheck } from "@/hooks/useCardChecks";
import { cardCheckPercent } from "@/services/cardChecks";
import "@/styles/card-checks.css";
type CheckState = ReturnType<typeof useCardCheck>;
export const cardPlanLink = (uuid: string) => `/?view=theme-manage&section=network&panel=plans&nodes=${encodeURIComponent(uuid)}`;
export function completionTone(check: CheckState) {
  const p = check.entry?.progress;
  return p?.counts.expected && p.counts.ok === p.counts.expected ? "success" : p && p.counts.ok + p.counts.partial > 0 ? "partial" : "failed";
}
export function CardCheckButton({ check, supported, configured, uuid, family, label }: {
  check: CheckState; supported: boolean; configured: boolean; uuid: string; family: "4" | "6"; label: string;
}) {
  if (!supported || !check.allowed) return null;
  if (!configured) return <a className="carrier-check-trigger" href={cardPlanLink(uuid)} title={`配置 IPv${family} ${label}方案`} aria-label={`配置 IPv${family} ${label}方案`}><Settings2 size={13} /></a>;
  return <button className="carrier-check-trigger" type="button" disabled={check.busy} data-busy={check.busy}
    aria-label={`立即检测 IPv${family} ${label}`} title={check.busy ? "检测进行中，进度显示在下方" : `按已配置方案检测 IPv${family} ${label}${label === "三网测速" ? "，会消耗测速流量" : ""}`}
    onClick={check.start}><RotateCw size={13} /></button>;
}
export function CardCheckFeedback({ check, uuid, children }: { check: CheckState; uuid: string; children: ReactNode }) {
  const entry = check.entry, p = entry?.progress, percent = cardCheckPercent(p);
  const finished = p?.phase === "finished" || p?.phase === "unavailable";
  const tone = completionTone(check);
  const label = entry?.pending ? "正在启动" : entry?.pollError ? "进度重连中" : entry?.syncing ? "更新结果" :
    finished ? p.phase === "unavailable" ? "报告不可用" : p.state === "cancelled" ? "已取消" : tone === "success" ? "已完成" : tone === "partial" ? "部分完成" : "未取得结果" :
    p ? `${p.phase === "queued" ? "排队" : "检测"} ${p.counts.completed}/${p.counts.expected}` : entry?.id ? "恢复进度" : "";
  return <>
    <div className="carrier-observation-footer">
      <span className="carrier-tested-at">{children}</span>
      {entry && !entry.error && <span className="carrier-check-status" data-tone={finished ? tone : "running"} role="status" aria-live="polite"
        title={entry.pollError ? "进度连接暂时中断，检测仍在服务器继续" : p?.waitReason || p?.suiteName}>
        {finished && !entry.syncing && (tone === "failed" ? <CircleAlert size={10} /> : <Check size={10} />)}{label}
      </span>}
    </div>
    {entry?.error && <p className="carrier-check-error" role="alert">{entry.error} <a href={cardPlanLink(uuid)}>配置方案</a></p>}
    {(check.busy || check.celebrate) && <div className="carrier-check-progress" data-queued={entry?.pending || !p || p.phase === "queued"} data-tone={finished ? tone : "running"}
      role="progressbar" aria-label="网络检测进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${label}，${percent}%`}>
      <span style={{ width: `${percent}%` }} />
    </div>}
  </>;
}
