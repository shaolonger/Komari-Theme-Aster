import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import "uplot/dist/uPlot.min.css";
import { InstanceDetails } from "@/components/instance/InstanceDetails";
import { PingChart } from "@/components/instance/PingChart";
import { LoadChart } from "@/components/instance/LoadChart";
import { TrafficChart } from "@/components/instance/TrafficChart";
import {
  buildLoadTimeRangeOptions,
  buildPingTimeRangeOptions,
  buildTrafficTimeRangeOptions,
} from "@/components/instance/chartShared";
import { useAllNodeMeta, useVisibleNodeUuids } from "@/hooks/useNode";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import type { NodeInfo } from "@/types/komari";
import { previousEveningInZone, resolveRangeInZone, type PingTimeRange } from "@/utils/pingTimeRange";
import { describeDisplayTimeZone } from "@/utils/timeDisplay";

import { NodeSwitcher } from "@/components/instance/NodeSwitcher";

const DEFAULT_PING_HOURS = 6;

export function Instance() {
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focus = searchParams.get("focus");
  const { data: config } = usePublicConfig();
  const themeSettings = useThemeSettings();
  const allNodes = useAllNodeMeta();
  const visibleNodeUuids = useVisibleNodeUuids();
  const [chartType, setChartType] = useState<"load" | "ping" | "traffic">(focus === "ping" ? "ping" : "load");
  const [loadHours, setLoadHours] = useState(0);
  const [pingHours, setPingHours] = useState(DEFAULT_PING_HOURS);
  const [trafficHours, setTrafficHours] = useState(24);
  const [customLoad, setCustomLoad] = useState(false);
  const [customPing, setCustomPing] = useState(false);
  const [customTraffic, setCustomTraffic] = useState(false);
  const [rangeDraft, setRangeDraft] = useState(() => previousEveningInZone(Date.now(), themeSettings.displayTimeZone));
  const [appliedRange, setAppliedRange] = useState<PingTimeRange>(() => resolveRangeInZone(
    previousEveningInZone(Date.now(), themeSettings.displayTimeZone),
    themeSettings.displayTimeZone,
  )!);
  const parsedRange = resolveRangeInZone(rangeDraft, themeSettings.displayTimeZone);
  const customRangeZoneLabel = describeDisplayTimeZone(themeSettings.displayTimeZone);

  useEffect(() => {
    const draft = previousEveningInZone(Date.now(), themeSettings.displayTimeZone);
    const resolved = resolveRangeInZone(draft, themeSettings.displayTimeZone);
    if (!resolved) return;
    setRangeDraft(draft);
    setAppliedRange(resolved);
  }, [themeSettings.displayTimeZone]);
  const chartControlsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!focus) return;
    if (focus === "ping") setChartType("ping");
    else if (["cpu", "ram", "disk"].includes(focus)) setChartType("load");
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(
          focus === "traffic" ? "instance-traffic" :
            focus === "expiry" ? "instance-expiry" :
              focus === "status" ? "instance-summary" :
                focus === "ping" ? "instance-chart-controls" :
                  "instance-chart-controls",
      ) ?? chartControlsRef.current;
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focus, uuid]);

  const nodeOptions = useMemo(() => {
    const nodeByUuid = new Map(allNodes.map((node) => [node.uuid, node]));
    const visibleNodes = visibleNodeUuids
      .map((nodeUuid) => nodeByUuid.get(nodeUuid))
      .filter((node): node is NodeInfo => Boolean(node));
    const currentNode = uuid ? nodeByUuid.get(uuid) : undefined;

    if (
      currentNode &&
      !visibleNodes.some((node) => node.uuid === currentNode.uuid)
    ) {
      return [currentNode, ...visibleNodes];
    }

    return visibleNodes;
  }, [allNodes, uuid, visibleNodeUuids]);
  const selectedNodeUuid =
    uuid && nodeOptions.some((node) => node.uuid === uuid) ? uuid : "";
  const loadRanges = useMemo(
    () => buildLoadTimeRangeOptions(config?.record_preserve_time),
    [config?.record_preserve_time],
  );
  const pingRanges = useMemo(
    () => buildPingTimeRangeOptions(config?.ping_record_preserve_time),
    [config?.ping_record_preserve_time],
  );
  const trafficRanges = useMemo(
    () => buildTrafficTimeRangeOptions(config?.record_preserve_time),
    [config?.record_preserve_time],
  );
  const showPingChart = themeSettings.isReady && themeSettings.showPingChart;
  const customRangeActive = chartType === "load"
    ? customLoad
    : chartType === "ping"
      ? customPing
      : customTraffic;
  const appliedRangeHours = (Date.parse(appliedRange.end) - Date.parse(appliedRange.start)) / 3_600_000;

  // 身份稳定:只读 ref,所以空依赖是安全的。它作为 onNodeReady 传给
  // InstanceDetails 的 effect;若身份不稳定,父组件每次重渲染都会取消挂起的 rAF
  // 又不重新调度,导致这次性的 scroll-into-view 丢失。
  const alignCharts = useCallback(() => {
    const frame = window.requestAnimationFrame(() => {
      const element = chartControlsRef.current;
      if (!element) return;
      // 只在图表控件不在视口内时才滚动过去,避免用户已经看着这块区域时,
      // 每次 mount/onNodeReady 都把视口猛地拽走。
      const rect = element.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < window.innerHeight) return;
      element.scrollIntoView({ behavior: "auto", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    return alignCharts();
  }, [alignCharts, uuid]);

  useEffect(() => {
    if (!loadRanges.some((range) => range.value === loadHours)) {
      setLoadHours(loadRanges[0]?.value ?? 0);
    }
  }, [loadHours, loadRanges]);

  useEffect(() => {
    if (!pingRanges.some((range) => range.value === pingHours)) {
      setPingHours(
        pingRanges.find((range) => range.value === DEFAULT_PING_HOURS)?.value ??
          pingRanges[0]?.value ??
          DEFAULT_PING_HOURS,
      );
    }
  }, [pingHours, pingRanges]);

  useEffect(() => {
    if (!trafficRanges.some((range) => range.value === trafficHours)) {
      setTrafficHours(trafficRanges.find((range) => range.value === 24)?.value ?? trafficRanges[0]?.value ?? 24);
    }
  }, [trafficHours, trafficRanges]);

  useEffect(() => {
    if (!showPingChart && chartType === "ping") {
      setChartType("load");
    }
  }, [chartType, showPingChart]);

  if (!uuid) return null;

  return (
    <div className="flex flex-col gap-5 py-2">
      <div className="instance-topbar">
        <Link
          to="/"
          className="instance-page-back"
        >
          <ChevronLeft size={14} />
          返回
        </Link>
        <NodeSwitcher key={uuid} nodes={nodeOptions} currentUuid={selectedNodeUuid} onSelect={(nextUuid) => {
          if (nextUuid !== uuid) startTransition(() => navigate(`/instance/${nextUuid}`));
        }} />
      </div>
      <InstanceDetails uuid={uuid} onNodeReady={alignCharts} />
      <section ref={chartControlsRef} id="instance-chart-controls" className="instance-panel instance-chart-workspace">
        <header className="instance-chart-workspace-header">
          <div className="instance-panel-headings">
            <h2 className="instance-panel-title">节点诊断</h2>
            <p className="instance-panel-description">选择监控指标与时间范围，检查节点状态变化。</p>
          </div>
          <div className="instance-chart-controls">
        <div className="instance-segmented">
          <button
            type="button"
            data-active={chartType === "load" ? "true" : "false"}
            aria-pressed={chartType === "load"}
            onClick={() => {
              startTransition(() => setChartType("load"));
            }}
          >
            负载
          </button>
          {showPingChart && (
            <button
              type="button"
              data-active={chartType === "ping" ? "true" : "false"}
              aria-pressed={chartType === "ping"}
              onClick={() => {
                startTransition(() => setChartType("ping"));
              }}
            >
              Ping
            </button>
          )}
          <button
            type="button"
            data-active={chartType === "traffic" ? "true" : "false"}
            aria-pressed={chartType === "traffic"}
            onClick={() => startTransition(() => setChartType("traffic"))}
          >
            流量
          </button>
        </div>
        {chartType === "load" && (
          <div
            key={`${chartType}-ranges`}
            className="instance-segmented is-scrollable"
          >
            {loadRanges.map((range) => (
              <button
                key={range.value}
                type="button"
                data-active={!customLoad && loadHours === range.value ? "true" : "false"}
                aria-pressed={!customLoad && loadHours === range.value}
                onClick={() => {
                  startTransition(() => {
                    setLoadHours(range.value);
                    setCustomLoad(false);
                  });
                }}
              >
                {range.label}
              </button>
            ))}
            <button type="button" data-active={customLoad ? "true" : "false"} aria-pressed={customLoad} onClick={() => setCustomLoad(true)}>自定义</button>
          </div>
        )}
        {chartType === "ping" && showPingChart && (
          <div
            key={`${chartType}-ranges`}
            className="instance-segmented is-scrollable"
          >
            {pingRanges.map((range) => (
              <button
                key={range.value}
                type="button"
                data-active={!customPing && pingHours === range.value ? "true" : "false"}
                aria-pressed={!customPing && pingHours === range.value}
                onClick={() => {
                  startTransition(() => {
                    setPingHours(range.value);
                    setCustomPing(false);
                  });
                }}
              >
                {range.label}
              </button>
            ))}
            <button type="button" data-active={customPing ? "true" : "false"} aria-pressed={customPing} onClick={() => setCustomPing(true)}>自定义</button>
          </div>
        )}
        {chartType === "traffic" && (
          <div key={`${chartType}-ranges`} className="instance-segmented is-scrollable">
            {trafficRanges.map((range) => (
              <button
                key={range.value}
                type="button"
                data-active={!customTraffic && trafficHours === range.value ? "true" : "false"}
                aria-pressed={!customTraffic && trafficHours === range.value}
                onClick={() => {
                  startTransition(() => {
                    setTrafficHours(range.value);
                    setCustomTraffic(false);
                  });
                }}
              >
                {range.label}
              </button>
            ))}
            <button type="button" data-active={customTraffic ? "true" : "false"} aria-pressed={customTraffic} onClick={() => setCustomTraffic(true)}>自定义</button>
          </div>
        )}
          </div>
        </header>
      {customRangeActive && (
        <form className="surface-inset flex flex-wrap items-end gap-3 p-3" onSubmit={(event) => {
          event.preventDefault();
          if (parsedRange) setAppliedRange(parsedRange);
        }}>
          <label className="flex flex-col gap-1 text-xs">开始时间（{customRangeZoneLabel}）
            <input required type="datetime-local" className="surface-inset p-2" value={rangeDraft.start} onChange={(event) => setRangeDraft({ ...rangeDraft, start: event.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs">结束时间（{customRangeZoneLabel}）
            <input required type="datetime-local" className="surface-inset p-2" value={rangeDraft.end} onChange={(event) => setRangeDraft({ ...rangeDraft, end: event.target.value })} />
          </label>
          <button type="submit" className="instance-toggle-button" disabled={!parsedRange}>应用时间范围</button>
          {!parsedRange && <span role="alert" className="text-xs">请选择有效时间，结束时间须晚于开始时间。</span>}
        </form>
      )}
      <div className="instance-chart-stage">
        <div
          className="instance-chart-view"
          hidden={chartType !== "load"}
          aria-hidden={chartType !== "load"}
        >
          <LoadChart
            uuid={uuid}
            hours={customLoad ? appliedRangeHours : loadHours}
            range={customLoad ? appliedRange : undefined}
            active={chartType === "load"}
          />
        </div>
        <div
          className="instance-chart-view"
          hidden={chartType !== "ping"}
          aria-hidden={chartType !== "ping"}
        >
          {showPingChart ? (
            <PingChart
              uuid={uuid}
              hours={customPing ? appliedRangeHours : pingHours}
              range={customPing ? appliedRange : undefined}
              retentionHours={config?.ping_record_preserve_time}
              active={chartType === "ping"}
            />
          ) : null}
        </div>
        <div
          className="instance-chart-view"
          hidden={chartType !== "traffic"}
          aria-hidden={chartType !== "traffic"}
        >
          <TrafficChart
            uuid={uuid}
            hours={customTraffic ? appliedRangeHours : trafficHours}
            range={customTraffic ? appliedRange : undefined}
            active={chartType === "traffic"}
          />
        </div>
      </div>
      </section>
    </div>
  );
}
