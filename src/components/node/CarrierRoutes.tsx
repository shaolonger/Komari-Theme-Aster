import { memo, useState } from "react";
import { useHomeRoutes } from "@/hooks/useHomeRoutes";
import { type RouteEvidence } from "@/services/homeRoutes";
import { formatDisplayDateTime } from "@/utils/timeDisplay";

function Evidence({
  value,
  direction,
  timeZone,
}: {
  value: RouteEvidence | null;
  direction: string;
  timeZone: string;
}) {
  const state = value?.state || "missing";
  const title = value
    ? `${direction} · ${value.label}${value.diagnostic ? " · " + value.diagnostic : ""} · ${value.asns.map((a) => `AS${a}`).join(" → ")} · ${formatDisplayDateTime(Date.parse(value.at), timeZone, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} · ${value.samples} 组观测${state === "partial" ? " · 路径不完整" : state === "stale" ? " · 超过24小时" : ""}`
    : `${direction}尚无探测结果`;
  return (
    <span
      className="carrier-route-evidence"
      data-state={state}
      title={title}
      aria-label={title}
    >
      {value?.label || "未探测"}
      {state === "stale" && <small>过期</small>}
      {state === "partial" && <small>部分</small>}
    </span>
  );
}
export const CarrierRoutes = memo(function CarrierRoutes({
  uuid,
  compact = false,
}: {
  uuid: string;
  compact?: boolean;
}) {
  const [family, setFamily] = useState<"4" | "6">("4");
  const routes = useHomeRoutes();
  const { displayTimeZone, isSlate } = routes;
  const node = routes.data?.nodes[uuid];
  // Empty routes stay out of existing compact dashboards. The reference theme
  // always retains this area, with an honest empty state.
  const hasMeasurements =
    node &&
    Object.values(node).some((rows) =>
      rows.some((row) => row.forward || row.return),
    );
  if (routes.data?.display === false || (!hasMeasurements && !isSlate))
    return null;
  const rows =
    node?.[family] ||
    ["电信", "联通", "移动"].map((carrier) => ({
      carrier,
      forward: null,
      return: null,
    }));
  return (
    <section
      className="carrier-routes"
      data-compact={compact}
      aria-label="三网线路"
    >
      <header className="carrier-routes-head">
        <strong>三网线路</strong>
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
      </header>
      <div className="carrier-routes-columns" aria-hidden>
        <span />
        <span>去程</span>
        <span />
        <span>回程</span>
      </div>
      {rows.map((row) => (
        <div className="carrier-route-row" key={row.carrier}>
          <strong>{row.carrier}</strong>
          <Evidence
            value={row.forward}
            direction={`${row.carrier} IPv${family} 去程（大陆→VPS）`}
            timeZone={displayTimeZone}
          />
          <span className="carrier-route-arrow" aria-hidden>
            ⇄
          </span>
          <Evidence
            value={row.return}
            direction={`${row.carrier} IPv${family} 回程（VPS→大陆）`}
            timeZone={displayTimeZone}
          />
        </div>
      ))}
      {!node && (
        <p className="carrier-routes-empty">
          {routes.isPending
            ? "正在读取线路…"
            : routes.isError
              ? "线路读取失败，请稍后刷新"
              : routes.data?.available
                ? "此节点未公开线路摘要"
                : "请升级网络观测插件至 1.9.1"}
        </p>
      )}
      {node && !rows.some((row) => row.forward || row.return) && (
        <p className="carrier-routes-empty">
          此地址族暂无测量，请运行大陆路由方案
        </p>
      )}
      {routes.data?.access === "admin" && (
        <a
          className="carrier-routes-empty"
          href={`/?view=theme-manage&section=network&panel=routes&nodes=${encodeURIComponent(uuid)}`}
        >
          {routes.data.published.includes(uuid)
            ? "已向访客发布 · 管理线路"
            : "管理员预览 · 尚未向访客发布"}
        </a>
      )}
      {routes.data?.access === "admin" &&
        rows.some((row) => row.forward?.reportId || row.return?.reportId) && (
          <a
            className="carrier-routes-empty"
            href={`/instance/${uuid}?focus=network&tab=routes&round=${rows.flatMap((row) => [row.forward, row.return]).find((value) => value?.reportId)?.reportId}`}
          >
            查看线路测量报告
          </a>
        )}
    </section>
  );
});
