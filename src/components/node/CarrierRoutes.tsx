import { lazy, memo, Suspense, useState } from "react";
import { useHomeRoutes } from "@/hooks/useHomeRoutes";
import { type RouteEvidence } from "@/services/homeRoutes";
import { formatDisplayDateTime } from "@/utils/timeDisplay";
import { routeHeadline } from "@/utils/carrierRoutePresentation";
import { useCardCheck } from "@/hooks/useCardChecks";
import { CardCheckButton, CardCheckFeedback, completionTone } from "./CardCheckControls";

const RouteDetails = lazy(() => import("./RouteEvidenceDetails"));

function Evidence({
  value,
  direction,
  timeZone,
  labelMode,
  showDetails,
}: {
  value: RouteEvidence | null;
  direction: string;
  timeZone: string;
  labelMode: "preferred" | "full";
  showDetails: boolean;
}) {
  const [open, setOpen] = useState(false);
  const state = value?.state || "missing";
  const status = !value ? "暂无观测" : state === "stale" ? "超过 24 小时"
    : value.observed === 0 || state === "missing" ? "缺少有效测量"
    : value.confirmed !== undefined ? `终点 ${value.confirmed}/${value.samples} 确认`
    : state === "partial" ? "终点未确认" : "终点已确认";
  const headline = routeHeadline(value, labelMode);
  const title = `${direction} · ${headline}${showDetails ? " · " + status : ""} · 点击查看完整观测`;
  const kind = value?.pathKind === "combined" ? "同路径多网" : value?.pathKind === "varied" ? "测量有差异" : "";
  return <>
    <button type="button" className="carrier-route-evidence" data-state={state} data-details={showDetails}
      title={title} aria-label={title} onClick={() => setOpen(true)}>
      <span>{headline}</span>{showDetails && <small>{state === "stale" ? status : kind && value?.confirmed !== undefined ? `${value.pathKind === "combined" ? "同路径" : "有差异"} · 终点 ${value.confirmed}/${value.samples}` : status}</small>}
    </button>
    {open && <Suspense fallback={<span role="status">正在打开线路证据…</span>}>
      <RouteDetails value={value} headline={headline} direction={direction} status={status} timeZone={timeZone} onClose={() => setOpen(false)} />
    </Suspense>}
  </>;

}
export const CarrierRoutes = memo(function CarrierRoutes({
  uuid,
  compact = false,
}: {
  uuid: string;
  compact?: boolean;
}) {
  const [selectedFamily, setFamily] = useState<"4" | "6" | null>(null);
  const routes = useHomeRoutes();
  const { displayTimeZone, isSlate } = routes;
  const node = routes.data?.nodes[uuid];
  const configured = routes.data?.quickFamilies[uuid] || [];
  const family = selectedFamily || (node?.["4"].some(r => r.forward || r.return) ? "4" : node?.["6"].some(r => r.forward || r.return) ? "6" : configured[0] || "4");
  const check = useCardCheck(uuid, "routes", family);
  // Empty routes stay out of existing compact dashboards. The reference theme
  // always retains this area, with an honest empty state.
  const hasMeasurements =
    node &&
    Object.values(node).some((rows) =>
      rows.some((row) => row.forward || row.return),
    );
  if (routes.data?.display === false || (!hasMeasurements && !isSlate && !configured.length))
    return null;
  const rows =
    node?.[family] ||
    ["电信", "联通", "移动"].map((carrier) => ({
      carrier,
      forward: null,
      return: null,
    }));
  const measurements = rows.flatMap(row => [row.forward, row.return]).filter(value => value !== null);
  const times = [...new Set(measurements.map(value => value.at))].sort();
  const at = times[times.length - 1];
  const formatTime = (value: string) => formatDisplayDateTime(Date.parse(value), displayTimeZone, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const timeRange = times.length ? `观测时间：${formatTime(times[0])} — ${formatTime(at)}` : "";
  return (
    <section
      className="carrier-routes"
      data-compact={compact}
      aria-label="三网线路"
      data-completion={check.celebrate ? completionTone(check) : undefined}
    >
      <header className="carrier-routes-head">
        <strong>三网线路</strong>
        <div className="carrier-observation-actions">
        <div
          className="carrier-family-switch"
          role="group"
          aria-label="线路地址族"
        >
          {(["4", "6"] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={family === f}
              onClick={() => setFamily(f)}
            >
              IPv{f}
            </button>
          ))}
        </div>
        <CardCheckButton check={check} supported={routes.data?.quickCheck === true} configured={configured.includes(family)} uuid={uuid} family={family} label="三网线路" />
        </div>
      </header>
      <div className="carrier-routes-columns" aria-hidden>
        <span />
        <span>去程</span>
        <span>回程</span>
      </div>
      {rows.map((row) => (
        <div className="carrier-route-row" key={row.carrier}>
          <strong>{row.carrier}</strong>
          <Evidence
            value={row.forward}
            direction={`${row.carrier} IPv${family} 去程（大陆→VPS）`}
            timeZone={displayTimeZone}
            labelMode={routes.data?.labelMode || "preferred"}
            showDetails={routes.data?.showDetails === true}
          />
          <Evidence
            value={row.return}
            direction={`${row.carrier} IPv${family} 回程（VPS→大陆）`}
            timeZone={displayTimeZone}
            labelMode={routes.data?.labelMode || "preferred"}
            showDetails={routes.data?.showDetails === true}
          />
        </div>
      ))}
      <CardCheckFeedback check={check} uuid={uuid}>
        {at ? <span className="carrier-speeds-time carrier-routes-time" title={timeRange}><span>最近测试 </span><time dateTime={at}>{formatDisplayDateTime(Date.parse(at), displayTimeZone, { month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23" })}</time></span>
          : routes.isPending ? "正在读取线路…" : routes.isError ? "线路读取失败" : `IPv${family} 尚未检测`}
      </CardCheckFeedback>
    </section>
  );
});
