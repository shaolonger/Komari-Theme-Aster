import {
  lazy,
  memo,
  Suspense,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarClock,
  ChartNoAxesColumnIncreasing,
  Clock3,
  Cpu,
  Database,
  DollarSign,
  Ellipsis,
  Gauge,
  Globe,
  HardDrive,
  Info,
  Layers,
  LayoutGrid,
  MapPin,
  MemoryStick,
  Network,
  RefreshCw,
  Route,
  TrendingUp,
} from "lucide-react";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { useHomeRoutes, useHomeSpeeds } from "@/hooks/useHomeRoutes";
import { useCardCheck } from "@/hooks/useCardChecks";
import { CardCheckFeedback } from "@/components/node/CardCheckControls";
import { Flag } from "@/components/ui/Flag";
import { OsLogo } from "@/components/ui/OsLogo";
import {
  buildHomepagePingCompareUrl,
  buildHomepagePingSourceRows,
  type HomepagePingSourceRow,
} from "@/utils/homepagePingSources";
import { formatBytes } from "@/utils/format";
import { formatDisplayDateTime } from "@/utils/timeDisplay";
import { regionLabel } from "@/utils/regionLabel";
import type { DenseNodeViewMode } from "@/utils/themeSettings";
import type { PingOverviewSample } from "@/types/komari";
import { routeHeadline } from "@/utils/carrierRoutePresentation";
import type { RouteEvidence } from "@/services/homeRoutes";
import type { HomeSpeedNode, SpeedValue } from "@/services/homeSpeeds";
import {
  CARRIERS,
  FAMILIES,
  identifyPingSource,
  pingSourceFamily,
  sampleColor,
  selectCarrierPing,
  observationFamilies,
  speedMeterPercent,
  SPEED_BAR_MAX_MBPS,
  type Carrier,
  type Family,
} from "./auroraModel";
import { ServerAvatar } from "./AuroraIcons";

const RouteDetails = lazy(
  () => import("@/components/node/RouteEvidenceDetails"),
);
const SpeedDetails = lazy(
  () => import("@/components/node/CarrierSpeedDetails"),
);
type Model = ReturnType<typeof useNodeCardModel>;
type Mode = "compact" | "standard" | "large";
type Panel = "all" | "quality" | "routes" | "speeds";
const QUALITY_HISTORY_SEGMENTS = 16;
const CRYSTAL_HISTORY_SEGMENTS = 9;
const pct = (v: number) => Math.max(0, Math.min(100, v));
const sampleLoss = (sample?: PingOverviewSample) => sample?.sampleCount
  ? ((sample.lossCount || 0) / sample.sampleCount) * 100
  : sample?.value === -1 ? 100 : 0;

function crystalHistoryTone(sample: PingOverviewSample | undefined, loss: boolean) {
  if (!sample || !Number.isFinite(sample.value)) return "empty";
  const value = loss ? sampleLoss(sample) : sample.value;
  if (sample.value < 0 || value >= (loss ? 10 : 225)) return "red";
  if (value >= (loss ? 6 : 205)) return "orange";
  if (value >= (loss ? 3 : 150)) return "yellow";
  return value >= (loss ? 1 : 125) ? "lime" : "green";
}

function Meter({
  value,
  className = "",
  label,
}: {
  value: number;
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={`aurora-meter ${className}`}
      role={label ? "meter" : undefined}
      aria-label={label}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? 100 : undefined}
      aria-valuenow={label ? pct(value) : undefined}
      title={label}
    >
      <i style={{ width: `${pct(value)}%` }} />
    </div>
  );
}

function HistoryStrip({
  source,
  lossOnly = false,
  segments = 32,
  historySlots,
}: {
  source?: HomepagePingSourceRow;
  lossOnly?: boolean;
  segments?: number;
  historySlots?: number;
}) {
  const samples = source?.samples.slice(historySlots == null ? -32 : -segments) || [];
  const cells = historySlots == null
    ? Array.from({ length: segments }, (_, index) => samples[Math.floor((index * samples.length) / segments)])
    : samples;
  return (
    <div
      className="aurora-history"
      data-metric={lossOnly ? "loss" : "latency"}
      style={historySlots ? { "--history-slots": historySlots } as CSSProperties : undefined}
      aria-label={
        source
          ? `${source.name}，${lossOnly ? "丢包率" : "延迟"}，最近 ${samples.length} 个采样；${source.title}`
          : "暂无质量历史"
      }
      title={source?.title || "未配置该运营商的 Ping 任务"}
    >
      {cells.map((sample, index) => {
        const loss = sampleLoss(sample);
        return (
          <i
            key={index}
            style={{
              background: sample
                ? sampleColor(sample.value, lossOnly ? loss : 0, lossOnly)
                : "var(--aurora-line)",
            }}
          />
        );
      })}
    </div>
  );
}

function QualityHistories({ source, historySlots }: { source?: HomepagePingSourceRow; historySlots?: number }) {
  return (
    <div className="aurora-quality-histories">
      <HistoryStrip source={source} segments={QUALITY_HISTORY_SEGMENTS} historySlots={historySlots} />
      <HistoryStrip source={source} lossOnly segments={QUALITY_HISTORY_SEGMENTS} historySlots={historySlots} />
    </div>
  );
}

function QualityValue({
  source,
  loss = false,
}: {
  source?: HomepagePingSourceRow;
  loss?: boolean;
}) {
  const value = loss ? source?.lossPercent : source?.latencyMs;
  const color =
    value == null
      ? undefined
      : loss
        ? value >= 5
          ? "#e6183a"
          : value >= 1
            ? "#879600"
            : "#128c16"
        : value >= 190
          ? "#b96700"
          : "#9e6800";
  return (
    <span className="aurora-quality-value" style={{ color }}>
      <b>
        {value == null
          ? "—"
          : loss
            ? value.toLocaleString("zh-CN", {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })
            : Math.round(value)}
      </b>
      <small>{loss ? "%" : "ms"}</small>
    </span>
  );
}

function CrystalQuality({ source, loss = false }: { source: HomepagePingSourceRow; loss?: boolean }) {
  const samples = source.samples.slice(-CRYSTAL_HISTORY_SEGMENTS);
  const value = loss ? source.lossPercent : source.latencyMs;
  const unit = loss ? "%" : "ms";
  return (
    <span className="crystal-quality-metric" title={source.title}>
      <span><b>{value == null ? "--" : value.toFixed(loss ? 1 : 2)}</b>{value != null && <> {unit}</>}</span>
      <span className="crystal-history" aria-hidden="true">
        {Array.from({ length: CRYSTAL_HISTORY_SEGMENTS }, (_, index) => {
          const sample = samples[index - CRYSTAL_HISTORY_SEGMENTS + samples.length];
          return <i key={index} data-tone={crystalHistoryTone(sample, loss)} />;
        })}
      </span>
    </span>
  );
}

function RouteValue({
  value,
  direction,
  carrier,
  timeZone,
  labelMode,
  crystalDirection,
}: {
  value?: RouteEvidence | null;
  direction: string;
  carrier?: Carrier;
  timeZone: string;
  labelMode: "preferred" | "full";
  crystalDirection?: "forward" | "return";
}) {
  const [open, setOpen] = useState(false);
  const headline = routeHeadline(value || null, labelMode);
  const Icon = crystalDirection === "return" ? ArrowLeft : ArrowRight;
  return (
    <>
      <button
        type="button"
        className={crystalDirection ? "crystal-route-value" : "aurora-pill"}
        data-carrier={carrier}
        data-state={value?.state || "missing"}
        data-direction={crystalDirection}
        data-network={crystalDirection ? headline : undefined}
        aria-label={crystalDirection ? `${direction} · ${headline}` : undefined}
        disabled={!value}
        onClick={() => setOpen(true)}
        title={`${direction} · ${headline} · ${value?.state === "stale" ? "超过 24 小时" : "查看线路证据"}`}
      >
        {crystalDirection ? (
          <>
            <span className="crystal-arrow"><Icon aria-hidden="true" /></span>
            <span className="crystal-route-label">{crystalDirection === "forward" ? "去" : "回"} <b>{value ? headline : "--"}</b></span>
          </>
        ) : headline}
      </button>
      {open && (
        <Suspense fallback={<span role="status">正在读取证据…</span>}>
          <RouteDetails
            value={value || null}
            headline={headline}
            direction={direction}
            status={
              value?.state === "stale"
                ? "超过 24 小时"
                : value?.state === "partial"
                  ? "终点未确认"
                  : "观测证据"
            }
            timeZone={timeZone}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}

function Speed({
  value,
  direction,
  onClick,
  bar = false,
  crystal = false,
}: {
  value?: SpeedValue;
  direction: "download" | "upload";
  onClick: () => void;
  bar?: boolean;
  crystal?: boolean;
}) {
  const bits = value?.bitsPerSecond;
  const Icon = direction === "download" ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      className={crystal ? "crystal-speed-value" : "aurora-speed"}
      data-direction={crystal ? direction : undefined}
      aria-label={crystal ? `${direction === "download" ? "下行" : "上行"} ${bits == null ? "暂无测速" : `${(bits / 1e6).toFixed(1)} Mbps`}` : undefined}
      disabled={bits == null}
      onClick={onClick}
      title={`${direction === "download" ? "下行 · 流入 VPS" : "上行 · 流出 VPS"} · ${value?.state === "partial" ? "部分结果 · " : ""}查看测量详情`}
    >
      {crystal ? (
        <>
          <span className="crystal-arrow"><Icon aria-hidden="true" /></span>
          <b>{bits == null ? "--" : (bits / 1e6).toFixed(1)}</b>
        </>
      ) : <span>
        <Icon />
        <b>
          {bits == null
            ? "—"
            : (bits / 1e6).toLocaleString("zh-CN", {
                maximumFractionDigits: 1,
              })}
        </b>
        <small>Mbps</small>
      </span>}
      {bar && (
        <Meter
          value={speedMeterPercent(bits)}
          label={`速率条范围：0–${SPEED_BAR_MAX_MBPS} Mbps`}
        />
      )}
    </button>
  );
}

function CheckAction({
  uuid,
  module,
  label,
}: {
  uuid: string;
  module: "routes" | "china-speed";
  label: string;
}) {
  const routes = useHomeRoutes(),
    speeds = useHomeSpeeds();
  const data = module === "routes" ? routes.data : speeds.data;
  const check4 = useCardCheck(uuid, module, "4"),
    check6 = useCardCheck(uuid, module, "6");
  const configured = data?.quickFamilies[uuid] || [];
  if (!data?.quickCheck || !check4.allowed || !configured.length) return null;
  const checks = [check4, check6].filter((_, i) =>
    configured.includes(FAMILIES[i]),
  );
  const busy = checks.some((check) => check.busy);
  return (
    <span className="aurora-check">
      <button
        type="button"
        disabled={busy}
        onClick={() => checks.forEach((check) => check.start())}
        title={`按已有方案检测 ${configured.map((f) => `IPv${f}`).join(" / ")}${module === "china-speed" ? "，会消耗测速流量" : ""}`}
      >
        <RefreshCw className={busy ? "animate-spin" : ""} />
        {busy ? "检测中" : label}
      </button>
      {checks
        .filter((check) => check.entry)
        .map((check, i) => (
          <CardCheckFeedback key={i} check={check} uuid={uuid}>
            {null}
          </CardCheckFeedback>
        ))}
    </span>
  );
}

function NodeSummary({
  model,
  mode,
  uuid,
}: {
  model: Model;
  mode: Mode;
  uuid: string;
}) {
  const [more, setMore] = useState(false);
  if (!model.node) return null;
  const {
    node,
    traffic,
    uptime,
    tags,
    expire,
    renewalPrice,
    upRate,
    downRate,
  } = model;
  const known = node.updatedAt > 0;
  const used = traffic.usagePercent;
  const usagePercent = known && used != null ? pct(used) : 0;
  const status =
    node.online === true
      ? `在线 ${uptime.value} ${uptime.unit}`
      : node.online === false
        ? "离线"
        : "待上报";
  const resources = [
    {
      label: "CPU",
      Icon: Cpu,
      value: known ? `${node.cpuPct.toFixed(1)}%` : "—",
      percent: node.cpuPct,
      detail: `${node.cpu_cores} 核`,
      tone: "blue",
    },
    {
      label: "内存",
      Icon: MemoryStick,
      value: known ? `${Math.round(node.ramPct)}%` : "—",
      percent: node.ramPct,
      detail: `${known ? formatBytes(node.ramUsed) : "—"} / ${formatBytes(node.ramTotal)}`,
      tone: "purple",
    },
    {
      label: "磁盘",
      Icon: HardDrive,
      value: known ? `${Math.round(node.diskPct)}%` : "—",
      percent: node.diskPct,
      detail: `${known ? formatBytes(node.diskUsed) : "—"} / ${formatBytes(node.diskTotal)}`,
      tone: "orange",
    },
    {
      label: "负载",
      Icon: Gauge,
      value: known ? node.load1.toFixed(2) : "—",
      percent: model.loadFraction * 100,
      detail: `5 分钟 ${known ? node.load5.toFixed(2) : "—"}`,
      tone: "pink",
    },
  ];
  const quota = (
    <div className="aurora-quota">
      <span>
        <Database />
        剩余流量 <strong>{known ? traffic.remainingLabel : "—"}</strong> /{" "}
        {node.traffic_limit > 0 ? formatBytes(node.traffic_limit) : "∞"}
      </span>
      <Meter
        value={usagePercent}
        className="aurora-quota-meter"
        label={
          used == null
            ? "不限量，已用比例不适用"
            : known
              ? `已用流量 ${usagePercent.toFixed(1)}%`
              : "暂无流量上报"
        }
      />
      <span className="aurora-reset">
        {traffic.typeLabel}
        {node.traffic_limit > 0 ? " · 按计费周期重置" : " · 不限量"}
      </span>
    </div>
  );
  const billing = (
    <div className="aurora-billing">
      <span>
        <CalendarClock />
        <span>
          {expire.unit ? (
            <>
              剩余{" "}
              <b>
                {expire.value} {expire.unit}
              </b>
            </>
          ) : (
            expire.value
          )}
        </span>
      </span>
      <span>
        <DollarSign />
        <strong>{renewalPrice || "未填写续费"}</strong>
      </span>
    </div>
  );
  return (
    <section className="aurora-summary" aria-label={`${node.name} 实时指标`}>
      <header className="aurora-node-header">
        {mode === "large" && <ServerAvatar />}
        <div className="aurora-identity">
          <div className="aurora-title">
            <Flag region={node.region} size={mode === "large" ? 34 : 48} />
            <Link to={`/instance/${uuid}`} title={node.name}>
              {node.name}
            </Link>
            {mode === "large" && (
              <span className="aurora-status" data-online={node.online}>
                {status}
              </span>
            )}
          </div>
          <p className="aurora-subtitle">
            {[
              regionLabel(node.region),
              node.public_remark,
              node.provider || node.group,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="aurora-tags">
            {tags.map((tag, i) => (
              <span key={i} data-muted={tag.color === "gray"} title={tag.label}>
                {tag.label}
              </span>
            ))}
          </div>
        </div>
        <div className="aurora-node-tools">
          <Link
            to={`/instance/${uuid}`}
            aria-label={`查看 ${node.name} 详情`}
            title="节点详情"
          >
            <Globe />
          </Link>
          <Link
            to={`/instance/${uuid}?focus=load`}
            aria-label={`${node.name} 性能趋势`}
            title="性能趋势"
          >
            <ChartNoAxesColumnIncreasing />
          </Link>
          <OsLogo value={node.os} size={32} />
          {mode === "large" && (
            <button
              type="button"
              onClick={() => setMore((v) => !v)}
              aria-expanded={more}
              aria-label="更多节点操作"
            >
              <Ellipsis />
            </button>
          )}
          {mode !== "large" && (
            <span className="aurora-status" data-online={node.online}>
              {status}
            </span>
          )}
        </div>
      </header>
      {more && (
        <div className="aurora-more">
          <Link to={`/instance/${uuid}`}>完整节点资料</Link>
          <Link to={`/instance/${uuid}?focus=ping`}>质量历史</Link>
          <Link to={`/instance/${uuid}/report`}>生成报告</Link>
        </div>
      )}
      <div className="aurora-vitals">
        <div className="aurora-resources aurora-inset">
          {resources.map(({ label, Icon, value, percent, detail, tone }) => (
            <div className="aurora-resource" data-tone={tone} key={label}>
              <div>
                <Icon />
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
              <Meter value={known ? percent : 0} />
              <small>{detail}</small>
            </div>
          ))}
        </div>
        <div className="aurora-transfer aurora-inset">
          <div className="aurora-rates">
            <span>
              <ArrowUp />
              <strong>{node.online ? upRate.value : "—"}</strong>
              <small>{upRate.unit}</small>
            </span>
            <span>
              <ArrowDown />
              <strong>{node.online ? downRate.value : "—"}</strong>
              <small>{downRate.unit}</small>
            </span>
          </div>
          {mode === "compact" ? (
            <div className="aurora-compact-quota">
              {quota}
              <b>
                {used == null
                  ? "不限量"
                  : known
                    ? `已用 ${usagePercent.toFixed(1)}%`
                    : "未上报"}
              </b>
            </div>
          ) : (
            <div className="aurora-totals">
              <span>
                <Database />
                <b>{known ? formatBytes(node.trafficUp) : "—"}</b>
              </span>
              <span>
                <ArrowDown />
                <b>{known ? formatBytes(node.trafficDown) : "—"}</b>
              </span>
            </div>
          )}
          {billing}
          {mode !== "large" && (
            <div className="aurora-connections">
              <span>
                TCP <b>{known ? node.connectionsTcp : "—"}</b>
              </span>
              <span>
                UDP <b>{known ? node.connectionsUdp : "—"}</b>
              </span>
            </div>
          )}
        </div>
      </div>
      {mode !== "compact" && quota}
    </section>
  );
}

export const NetworkSummary = memo(function NetworkSummary({
  ping,
  uuid,
  mode,
  denseView,
  crystal = false,
}: {
  ping: Model["ping"];
  uuid: string;
  mode: Mode;
  denseView?: DenseNodeViewMode;
  crystal?: boolean;
}) {
  const settings = useThemeSettings(),
    routes = useHomeRoutes(),
    speeds = useHomeSpeeds();
  const [selectedPanel, setPanel] = useState<Panel>("all"),
    [city, setCity] = useState("北京");
  const [selectedFamily, setFamily] = useState<Family>("4");
  const [speedDetail, setSpeedDetail] = useState<HomeSpeedNode | null>(null);
  const rows = buildHomepagePingSourceRows(
    ping,
    settings.homepagePingTaskGroups,
    settings.homepagePingTaskOrder[uuid],
  );
  const routeNode =
    routes.data?.display === false ? undefined : routes.data?.nodes[uuid];
  const speedNode =
    speeds.data?.display === false ? undefined : speeds.data?.nodes[uuid];
  const qualityFamilies = settings.showPingChart
    ? observationFamilies(
        undefined,
        rows.flatMap((row) => {
          const identity = identifyPingSource(row);
          return identity ? [identity.family] : [];
        }),
      )
    : [];
  const routeFamilies =
    routes.data?.display === false
      ? []
      : observationFamilies(
          routes.data?.configuredFamilies?.[uuid] ??
            (routes.data?.quickCheck
              ? routes.data.quickFamilies[uuid] || []
              : undefined),
          FAMILIES.filter((f) =>
            routeNode?.[f].some((row) => row.forward || row.return),
          ),
        );
  const speedFamilies =
    speeds.data?.display === false
      ? []
      : observationFamilies(
          speeds.data?.configuredFamilies?.[uuid] ??
            (speeds.data?.quickCheck
              ? speeds.data.quickFamilies[uuid] || []
              : undefined),
          FAMILIES.filter((f) => speedNode?.[f] != null),
        );
  const qualityVisible = qualityFamilies.length > 0;
  const routesVisible = routeFamilies.length > 0;
  const speedsVisible = speedFamilies.length > 0;
  const panel =
    (selectedPanel === "quality" && !qualityVisible) ||
    (selectedPanel === "routes" && !routesVisible) ||
    (selectedPanel === "speeds" && !speedsVisible)
      ? "all"
      : selectedPanel;
  const qualityShown =
    qualityVisible && (panel === "all" || panel === "quality");
  const routesShown = routesVisible && (panel === "all" || panel === "routes");
  const speedsShown = speedsVisible && (panel === "all" || panel === "speeds");
  const families = observationFamilies(undefined, [
    ...(qualityShown ? qualityFamilies : []),
    ...(routesShown ? routeFamilies : []),
    ...(speedsShown ? speedFamilies : []),
  ]);
  const compactFamily = families.includes(selectedFamily)
    ? selectedFamily
    : families[0];
  const gridMetrics = [
    qualityShown ? "1fr 1fr" : "",
    routesShown ? "1.25fr" : "",
    speedsShown ? "1.5fr" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const cities = [
    ...new Set(
      speedFamilies.flatMap(
        (f) => speedNode?.[f]?.cities.map((c) => c.city) || [],
      ),
    ),
  ];
  const selectedCity = cities.includes(city as "北京")
    ? city
    : cities[0] || "北京";
  const routeTimes = routeFamilies
    .flatMap(
      (f) =>
        routeNode?.[f]
          .flatMap((r) => [r.forward?.at, r.return?.at])
          .filter((t): t is string => Boolean(t)) || [],
    )
    .sort();
  const speedTimes = speedFamilies
    .flatMap((f) => (speedNode?.[f]?.at ? [speedNode[f]!.at] : []))
    .sort();
  const time = (at?: string) =>
    at
      ? formatDisplayDateTime(Date.parse(at), settings.displayTimeZone, {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        })
      : "暂无检测";
  const historyCount = Math.max(0, ...rows.map((row) => row.samples.length));
  const qualityRows = mode === "standard" && !crystal ? CARRIERS.map((carrier) => ({
    carrier,
    sources: qualityFamilies.map((family) => ({ family, source: selectCarrierPing(rows, carrier, family) })),
  })) : [];
  const historySlots = denseView && !crystal
    ? Math.min(QUALITY_HISTORY_SEGMENTS, Math.max(
        0,
        ...qualityRows.flatMap(({ sources }) => sources.map(({ source }) => source?.samples.length ?? 0)),
      ))
    : undefined;
  const compareUrl = buildHomepagePingCompareUrl(
    uuid,
    rows.map((row) => row.taskId),
  );
  const cityPicker = (
    <label className="aurora-city">
      <MapPin />
      <select
        aria-label="测速地区"
        value={selectedCity}
        disabled={!cities.length}
        onChange={(e) => setCity(e.target.value)}
      >
        {(cities.length ? cities : ["北京"]).map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </label>
  );
  const routePair = (carrier: Carrier | undefined, family: Family, taskName?: string) => {
    const row = carrier && (!crystal || routeFamilies.includes(family))
      ? routeNode?.[family].find((row) => row.carrier === carrier)
      : undefined;
    const title = carrier ? `${carrier} IPv${family}` : taskName;
    return (
      <div className={crystal ? "crystal-route-pair" : "aurora-route-pair"}>
        <RouteValue
          value={row?.forward}
          direction={`${title} 去程（大陆 → VPS）`}
          carrier={carrier}
          timeZone={settings.displayTimeZone}
          labelMode={routes.data?.labelMode || "preferred"}
          crystalDirection={crystal ? "forward" : undefined}
        />
        {!crystal && <ArrowRight />}
        <RouteValue
          value={row?.return}
          direction={`${title} 回程（VPS → 大陆）`}
          carrier={carrier}
          timeZone={settings.displayTimeZone}
          labelMode={routes.data?.labelMode || "preferred"}
          crystalDirection={crystal ? "return" : undefined}
        />
      </div>
    );
  };
  const speedPair = (carrier: Carrier | undefined, family: Family, bar = false) => {
    const snapshot = carrier && (!crystal || speedFamilies.includes(family)) ? speedNode?.[family] : undefined,
      row = snapshot?.cities
        .find((c) => c.city === selectedCity)
        ?.rows.find((r) => r.carrier === carrier);
    return (
      <div
        className={crystal ? "crystal-speed-pair" : "aurora-speed-pair"}
        data-stale={snapshot?.stale}
        title={snapshot?.stale ? "测速结果超过有效期" : undefined}
      >
        <Speed
          value={row?.download}
          direction="download"
          bar={bar}
          crystal={crystal}
          onClick={() => setSpeedDetail(snapshot || null)}
        />
        <Speed
          value={row?.upload}
          direction="upload"
          bar={bar}
          crystal={crystal}
          onClick={() => setSpeedDetail(snapshot || null)}
        />
      </div>
    );
  };
  const heading = (Icon: typeof Activity, title: string, tail?: ReactNode) => (
    <header className="aurora-section-head">
      <h3>
        <Icon />
        {title}
      </h3>
      {tail}
    </header>
  );
  const tabs = (
    <div className="aurora-tabs" role="group" aria-label="三网视图">
      {(
        [
          {
            value: "all",
            label: mode === "large" ? "三网监测" : "综合视图",
            Icon: mode === "large" ? Activity : LayoutGrid,
          },
          {
            value: "quality",
            label: mode === "large" ? "质量趋势" : "质量",
            Icon: TrendingUp,
          },
          {
            value: "routes",
            label: mode === "large" ? "路由详情" : "线路",
            Icon: Network,
          },
          {
            value: "speeds",
            label: mode === "large" ? "测速记录" : "测速",
            Icon: Gauge,
          },
        ] as const
      )
        .filter(
          ({ value }) =>
            value === "all" ||
            (value === "quality" && qualityVisible) ||
            (value === "routes" && routesVisible) ||
            (value === "speeds" && speedsVisible),
        )
        .map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={panel === value}
            onClick={() => setPanel(value)}
          >
            <Icon />
            {label}
          </button>
        ))}
    </div>
  );
  // Ping summaries can outlive a binding change until the next poll.
  const crystalRows = crystal ? rows.flatMap(source => {
    if (!settings.homepagePingBindings[String(source.taskId)]?.includes(uuid)) return [];
    const identity = identifyPingSource(source);
    const carrier = identity?.carrier;
    const family = identity?.family ?? pingSourceFamily(source);
    if (!settings.showPingChart && (!carrier || (!routeFamilies.includes(family) && !speedFamilies.includes(family)))) return [];
    return [{ carrier, family, source }];
  }) : [];
  const extraRows = crystal ? [] : rows.filter(row => !identifyPingSource(row));
  const crystalColumns = [
    "minmax(0, 20fr)",
    routes.data?.display !== false && "minmax(0, 21fr)",
    settings.showPingChart && "minmax(0, 38fr)",
    speeds.data?.display !== false && "minmax(0, 19fr)",
  ].filter(Boolean).join(" ");
  return (
    <section
      className={crystal ? "crystal-network" : `aurora-network aurora-network-${mode}`}
      aria-label="三网网络表现"
      data-panel={panel}
      style={crystal ? { "--crystal-network-columns": crystalColumns } as CSSProperties
        : { "--aurora-metrics": gridMetrics || "1fr" } as CSSProperties}
    >
      {mode === "compact" && (
        <header className="aurora-network-heading">
          <div>
            <h2>
              <span>
                <Activity />
              </span>
              三网网络表现
            </h2>
            <p>延迟 · 丢包 · 线路 · 速度 一体化观测</p>
          </div>
          <div>
            {tabs}
            {cityPicker}
          </div>
        </header>
      )}
      {mode === "large" && (
        <header className="aurora-network-toolbar">
          {tabs}
          <span>最近检测: {time(routeTimes.at(-1))}</span>
          <CheckAction
            uuid={uuid}
            module={panel === "speeds" ? "china-speed" : "routes"}
            label="重新检测"
          />
          {panel === "speeds" && cityPicker}
        </header>
      )}
      {crystal ? (
        <>
          {crystalRows.map(({ carrier, family, source }) => {
            const name = source.name || `任务 #${source.taskId}`;
            return (
              <div className="crystal-network-row" key={source.taskId} data-family={family} data-carrier={carrier}>
                <strong className="crystal-network-name" title={name}>{name}</strong>
                {routes.data?.display !== false && routePair(carrier, family, name)}
                {settings.showPingChart && (
                  <Link className="crystal-quality" to={buildHomepagePingCompareUrl(uuid, [source.taskId])}
                    aria-label={`${name} 质量历史 · 延迟 ${source.latencyLabel} · 丢包 ${source.lossLabel}`}>
                    <CrystalQuality source={source} />
                    <CrystalQuality source={source} loss />
                  </Link>
                )}
                {speeds.data?.display !== false && speedPair(carrier, family)}
              </div>
            );
          })}
          {(routesVisible || speedsVisible) && (
            <footer className="crystal-network-controls">
              {denseView === "standard" && routesVisible && <span>最近检测 {time(routeTimes.at(-1))}</span>}
              {denseView === "standard" && speedsVisible && <span>最近测速 {time(speedTimes.at(-1))} · P1 单连接</span>}
              <div className="crystal-network-actions">
                {speedsVisible && (cities.length > 1 || denseView === "standard") && cityPicker}
                {routesVisible && <CheckAction uuid={uuid} module="routes" label="检测线路" />}
                {speedsVisible && <CheckAction uuid={uuid} module="china-speed" label="测速" />}
              </div>
            </footer>
          )}
        </>
      ) : mode === "standard" ? (
        <>
          {qualityVisible && (
            <section className="aurora-section aurora-quality-section aurora-inset">
              {heading(
                Activity,
                "三网质量",
                <span>延迟 / 丢包 · {historySlots ?? historyCount} 次历史</span>,
              )}
              <div
                className="aurora-quality-labels"
                data-family-count={qualityFamilies.length}
              >
                <span>运营商</span>
                {qualityFamilies.map((f) => (
                  <span className="aurora-family" key={f}>
                    IPv{f}
                  </span>
                ))}
              </div>
              {qualityRows.map(({ carrier, sources }) => (
                <div
                  className="aurora-quality-row"
                  key={carrier}
                  data-family-count={qualityFamilies.length}
                >
                  <strong data-carrier={carrier}>{carrier}</strong>
                  {sources.map(({ family, source }) => (
                    <Link
                      to={compareUrl}
                      key={family}
                      data-family={family}
                      aria-label={`${carrier} IPv${family} 质量历史`}
                    >
                      <div>
                        <QualityValue source={source} />
                        <QualityValue source={source} loss />
                      </div>
                      <QualityHistories source={source} historySlots={historySlots} />
                    </Link>
                  ))}
                </div>
              ))}
            </section>
          )}
          {routesVisible && (
            <section className="aurora-section aurora-route-section aurora-inset">
              {heading(
                Route,
                "三网线路",
                <CheckAction uuid={uuid} module="routes" label="检测" />,
              )}
              <div
                className="aurora-dual"
                data-family-count={routeFamilies.length}
              >
                {routeFamilies.map((f) => (
                  <div key={f} data-family={f}>
                    <div className="aurora-table-labels">
                      <span className="aurora-family">IPv{f}</span>
                      <span>去程 →</span>
                      <span>← 回程</span>
                    </div>
                    {CARRIERS.map((carrier) => (
                      <div
                        className="aurora-table-row"
                        key={carrier}
                        data-carrier={carrier}
                      >
                        <strong>{carrier}</strong>
                        {routePair(carrier, f)}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              {denseView !== "compact" && (
                <footer>
                  <span>最近检测 {time(routeTimes.at(-1))}</span>
                  {!denseView && <span>去程：大陆 → VPS · 回程：VPS → 大陆</span>}
                </footer>
              )}
            </section>
          )}
          {speedsVisible && (
            <section className="aurora-section aurora-speed-section aurora-inset">
              {heading(
                Gauge,
                "三网测速",
                <>
                  <small>Mbps</small>
                  <div>
                    {cityPicker}
                    <CheckAction
                      uuid={uuid}
                      module="china-speed"
                      label="测速"
                    />
                  </div>
                </>,
              )}
              <div
                className="aurora-dual"
                data-family-count={speedFamilies.length}
              >
                {speedFamilies.map((f) => (
                  <div key={f} data-family={f}>
                    <div className="aurora-table-labels">
                      <span className="aurora-family">IPv{f}</span>
                      <span>↓ 下行</span>
                      <span>↑ 上行</span>
                    </div>
                    {CARRIERS.map((carrier) => (
                      <div
                        className="aurora-table-row"
                        key={carrier}
                        data-carrier={carrier}
                      >
                        <strong>{carrier}</strong>
                        {speedPair(carrier, f)}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              {denseView !== "compact" && (
                <footer>
                  <span>最近测速 {time(speedTimes.at(-1))} · P1 单连接</span>
                  {!denseView && <span>下行：流入 VPS · 上行：流出 VPS</span>}
                </footer>
              )}
            </section>
          )}
        </>
      ) : mode === "compact" ? (
        <div
          className="aurora-matrix"
          data-family-count={families.length}
          hidden={!families.length}
        >
          <div
            className="aurora-family-switch"
            role="group"
            aria-label="检测地址族"
          >
            {families.map((f) =>
              families.length === 1 ? (
                <span key={f} className="aurora-family">
                  IPv{f}
                </span>
              ) : (
                <button
                  key={f}
                  type="button"
                  aria-pressed={compactFamily === f}
                  onClick={() => setFamily(f)}
                >
                  IPv{f}
                </button>
              ),
            )}
          </div>
          {families.map((f) => (
            <div
              className="aurora-matrix-family"
              key={f}
              data-family={f}
              hidden={f !== compactFamily}
            >
              {CARRIERS.map((carrier) => {
                const source = selectCarrierPing(rows, carrier, f);
                return (
                  <div
                    key={carrier}
                    className="aurora-matrix-cell aurora-inset"
                    data-carrier={carrier}
                  >
                    <strong className="aurora-cell-carrier-name">
                      {carrier}
                    </strong>
                    {qualityShown && qualityFamilies.includes(f) && (
                      <Link to={compareUrl} className="aurora-cell-quality">
                        <div>
                          <Activity />
                          <QualityValue source={source} />
                          <span>丢包</span>
                          <QualityValue source={source} loss />
                        </div>
                        <QualityHistories source={source} />
                      </Link>
                    )}
                    {routesShown && routeFamilies.includes(f) && (
                      <div className="aurora-cell-route">
                        <span>
                          <Route />
                          线路
                        </span>
                        <div className="aurora-route-labels">
                          <small>去程</small>
                          <small>回程</small>
                        </div>
                        {routePair(carrier, f)}
                      </div>
                    )}
                    {speedsShown && speedFamilies.includes(f) && (
                      <div className="aurora-cell-speed">
                        <span>
                          <Gauge />
                          测速
                        </span>
                        {speedPair(carrier, f, true)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <div
          className="aurora-network-table aurora-inset"
          hidden={!families.length}
        >
          <div className="aurora-large-columns">
            <span>运营商</span>
            {(panel === "all" || panel === "quality") && qualityVisible && (
              <>
                <span>
                  <Clock3 />
                  延迟
                </span>
                <span>
                  <Layers />
                  丢包率
                </span>
              </>
            )}
            {routesShown && (
              <span>
                <Network />
                线路 <small>（去程 → 回程）</small>
              </span>
            )}
            {speedsShown && (
              <span>
                <Gauge />
                测速 <small>（下载 / 上传 Mbps）</small>
              </span>
            )}
          </div>
          {CARRIERS.map((carrier) => (
            <div
              className="aurora-large-carrier"
              key={carrier}
              data-carrier={carrier}
            >
              <div className="aurora-large-carrier-name">
                <strong>中国{carrier}</strong>
              </div>
              <div>
                {families.map((f) => {
                  const source = selectCarrierPing(rows, carrier, f);
                  return (
                    <div className="aurora-large-row" key={f} data-family={f}>
                      <span className="aurora-family">IPv{f}</span>
                      {(panel === "all" || panel === "quality") &&
                        qualityVisible &&
                        (qualityFamilies.includes(f) ? (
                          <>
                            <Link to={compareUrl} title={source?.title}>
                              <QualityValue source={source} />
                              <HistoryStrip source={source} />
                            </Link>
                            <Link to={compareUrl} title={source?.title}>
                              <QualityValue source={source} loss />
                              <HistoryStrip source={source} lossOnly />
                            </Link>
                          </>
                        ) : (
                          <>
                            <span
                              className="aurora-unconfigured-cell"
                              aria-hidden="true"
                            />
                            <span
                              className="aurora-unconfigured-cell"
                              aria-hidden="true"
                            />
                          </>
                        ))}
                      {routesShown &&
                        (routeFamilies.includes(f) ? (
                          routePair(carrier, f)
                        ) : (
                          <span
                            className="aurora-unconfigured-cell"
                            aria-hidden="true"
                          />
                        ))}
                      {speedsShown &&
                        (speedFamilies.includes(f) ? (
                          speedPair(carrier, f, true)
                        ) : (
                          <span
                            className="aurora-unconfigured-cell"
                            aria-hidden="true"
                          />
                        ))}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <footer>
            <span>
              <Info />
              线路说明：去程：大陆 → VPS　 |　 回程：VPS → 大陆
            </span>
            <Link to={compareUrl}>
              {historyCount} 次历史检测　 |　 单线程　 |　 速率条范围：0 – 500
              Mbps
            </Link>
          </footer>
        </div>
      )}
      {mode === "compact" && (
        <footer className="aurora-network-footer">
          <span>
            <Clock3 />
            最近检测：{time(routeTimes.at(-1))}　 |　 最近测速：
            {time(speedTimes.at(-1))}
          </span>
          <Link to={compareUrl}>
            <Info />
            去程：大陆 → VPS　 |　 回程：VPS → 大陆　 |　 {historyCount}{" "}
            次质量历史
          </Link>
        </footer>
      )}
      {(routes.isError || (!routes.data?.available && !routes.isPending)) && (
        <p className="aurora-empty">
          {routes.isError
            ? "线路摘要读取失败，可稍后重试。"
            : "暂无线路观测；可在工作室配置网络观测。"}
        </p>
      )}
      {!crystal && !families.length && !routes.isPending && !extraRows.length && (
        <p className="aurora-empty">尚未配置三网检测任务</p>
      )}
      {settings.showPingChart && !!extraRows.length && (
        <details className="aurora-extra">
          <summary>其他质量观测（{extraRows.length}）</summary>
          {extraRows.map((row) => (
            <Link to={compareUrl} key={row.taskId}>
              {row.name}
              <QualityValue source={row} />
              <QualityValue source={row} loss />
            </Link>
          ))}
        </details>
      )}
      {speedDetail && (
        <Suspense fallback={<p role="status">正在读取测速详情…</p>}>
          <SpeedDetails
            uuid={uuid}
            node={speedDetail}
            city={selectedCity}
            timeZone={settings.displayTimeZone}
            admin={speeds.data?.access === "admin"}
            onClose={() => setSpeedDetail(null)}
          />
        </Suspense>
      )}
    </section>
  );
});

export default memo(function AuroraNodeCard({
  uuid,
  mode,
}: {
  uuid: string;
  mode: Mode;
}) {
  const model = useNodeCardModel(uuid);
  if (!model.node)
    return (
      <article className="aurora-node-card aurora-glass" aria-busy="true">
        正在读取节点…
      </article>
    );
  return (
    <article
      className="aurora-node-card"
      data-mode={mode}
      data-online={model.node.online}
      data-node={uuid}
    >
      <NodeSummary model={model} mode={mode} uuid={uuid} />
      <NetworkSummary ping={model.ping} uuid={uuid} mode={mode} />
    </article>
  );
});
