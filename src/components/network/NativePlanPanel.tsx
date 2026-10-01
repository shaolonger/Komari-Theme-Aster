import { WebsiteTargetPicker } from "./WebsiteTargetPicker";
import { useState } from "react";
import {
  Network,
  Gauge,
  Globe2,
  HardDrive,
  Radio,
  Clock3,
  Layers3,
  Plus,
  Search,
  Check,
  Copy,
  ArrowRight,
} from "lucide-react";
import { NetworkSectionHeading } from "./NetworkUi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  nativeCatalog,
  nativeEndpoint,
  previewNative,
  saveNative,
  registerProbe,
  revokeProbe,
  runNative,
  removeNative,
  type NativeDraft,
  type NativePolicy,
} from "@/services/nativeObservatory";
import { formatNetworkTime } from "./shared";
import { reportCapabilities } from "@/services/reportObservatory";
import { ReportResourcesPanel } from "./ReportResourcesPanel";
import { ReportPlanPanel } from "./ReportPlanPanel";
import { NetworkDrawer } from "./NetworkDrawer";
type PlanPanelProps = {
  initialNodes: string[];
  primaryNode?: string;
  onApplied?: () => void;
};
export function NativePlanPanel(props: PlanPanelProps) {
  const capability = useQuery({
    queryKey: ["report-capabilities"],
    queryFn: reportCapabilities,
    retry: false,
    staleTime: 60000,
  });
  const [resources, setResources] = useState(false),
    [legacyResources, setLegacyResources] = useState(false);
  if (!capability.data) return <LegacyNativePlanPanel {...props} />;
  return (
    <>
      <ReportPlanPanel
        uuid={props.primaryNode}
        initialNodes={props.initialNodes}
        onApplied={props.onApplied}
        onResources={() => setResources(true)}
      />
      {resources && (
        <NetworkDrawer
          title="测量点接入与 VPS 公网地址"
          onClose={() => setResources(false)}
        >
          <ReportResourcesPanel
            onLegacy={() => {
              setResources(false);
              setLegacyResources(true);
            }}
          />
        </NetworkDrawer>
      )}
      {legacyResources && (
        <NetworkDrawer
          title="测量点接入与 VPS 公网地址"
          onClose={() => setLegacyResources(false)}
        >
          <LegacyNativePlanPanel
            {...props}
            resourcesOnly
            onApplied={undefined}
          />
        </NetworkDrawer>
      )}
    </>
  );
}

function LegacyNativePlanPanel({
  initialNodes,
  primaryNode,
  onApplied,
  resourcesOnly = false,
}: {
  initialNodes: string[];
  primaryNode?: string;
  onApplied?: () => void;
  resourcesOnly?: boolean;
}) {
  const cache = useQueryClient(),
    catalog = useQuery({
      queryKey: ["native-catalog"],
      queryFn: nativeCatalog,
      staleTime: 10000,
      refetchInterval: 15000,
      retry: false,
    });
  const [kind, setKind] = useState<NativeDraft["kind"]>("websites"),
    [clients, setClients] = useState(initialNodes),
    [groups, setGroups] = useState<string[]>([]),
    [sources, setSources] = useState<string[]>([]),
    [sites, setSites] = useState<string[] | null>(null),
    [policyName, setPolicyName] = useState(""),
    [daily, setDaily] = useState(false),
    [times, setTimes] = useState(["21:00"]),
    [timezone, setTimezone] = useState("Asia/Shanghai"),
    [minutes, setMinutes] = useState(15),
    [family, setFamily] = useState<"4" | "6">("4"),
    [protocol, setProtocol] = useState<"tcp" | "icmp">("tcp"),
    [seconds, setSeconds] = useState(10),
    [streams, setStreams] = useState([1, 4]),
    [publicSources, setPublicSources] = useState(true),
    [inherit, setInherit] = useState(true),
    [accepted, setAccepted] = useState(false),
    [edit, setEdit] = useState<NativePolicy | undefined>(),
    [preview, setPreview] = useState<Awaited<
      ReturnType<typeof previewNative>
    > | null>(null),
    [step, setStep] = useState(1),
    [view, setView] = useState<"plan" | "setup" | "manage">(
      resourcesOnly ? "setup" : "plan",
    ),
    [nodeSearch, setNodeSearch] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [probeName, setProbeName] = useState(""),
    [city, setCity] = useState(""),
    [carrier, setCarrier] = useState("电信"),
    [access, setAccess] = useState("家庭宽带"),
    [publicAddress, setPublicAddress] = useState(""),
    [credential, setCredential] = useState<{
      id: string;
      token: string;
    } | null>(null),
    [base, setBase] = useState(window.location.origin),
    [endpointUuid, setEndpointUuid] = useState(
      primaryNode || initialNodes[0] || "",
    ),
    [endpoint, setEndpoint] = useState<string | null>(null),
    [port, setPort] = useState<number | null>(null);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      await cache.invalidateQueries({ queryKey: ["native-catalog"] });
      await cache.invalidateQueries({ queryKey: ["report-catalog"] });
      await cache.invalidateQueries({ queryKey: ["native-reports"] });
      onApplied?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  if (catalog.isPending) return <p role="status">正在读取原生检测方案…</p>;
  if (!catalog.data)
    return (
      <div className="network-empty-state">
        <strong>请更新并启用网络观测插件 v1.5.0 或以上</strong>
        <p role="alert">{catalog.error?.message}</p>
        <button onClick={() => void catalog.refetch()}>重试</button>
      </div>
    );
  const data = catalog.data;
  const draft: NativeDraft = {
    id: edit?.id,
    revision: data.revision,
    name:
      policyName.trim() ||
      {
        routes: "大陆双向线路",
        speed: "大陆双向测速",
        websites: "国际网站体验",
      }[kind],
    kind,
    clients,
    groups,
    sources,
    sites: sites ?? data.websites.slice(0, 6),
    family,
    protocol,
    seconds,
    streams,
    timing: daily
      ? {
          type: "daily",
          times: times.filter(Boolean),
          timezone,
        }
      : { type: "interval", minutes: kind === "speed" ? 1440 : minutes },
    publicSources,
    enabled: true,
    inherit,
    trafficAccepted: accepted,
  };
  function toggle(
    list: string[],
    value: string,
    update: (v: string[]) => void,
  ) {
    update(
      list.includes(value) ? list.filter((x) => x !== value) : [...list, value],
    );
    setPreview(null);
  }
  function editing(p: NativePolicy) {
    setEdit(p);
    setPolicyName(p.name);
    setKind(p.kind);
    setClients(p.clients);
    setGroups(p.groups);
    setSources(p.sources);
    setSites(p.sites);
    setFamily(p.family);
    setProtocol(p.protocol);
    setSeconds(p.seconds);
    setStreams(p.streams);
    setPublicSources(p.publicSources);
    setInherit(p.inherit);
    setAccepted(p.trafficAccepted);
    setDaily(p.timing.type === "daily");
    if (p.timing.type === "daily") {
      setTimes(p.timing.times);
      setTimezone(p.timing.timezone);
    } else setMinutes(p.timing.minutes);
    setStep(1);
    setView("plan");
    setPreview(null);
  }
  const quote = (v: string) => "'" + v.replace(/'/g, "'\\''") + "'";
  const command = credential
    ? `curl -fsSL https://github.com/shaolonger/Komari-Theme-Aster/releases/latest/download/Aster-Network-Observatory-install.sh | sudo sh -s -- --server-url ${quote(base)} --probe-id ${quote(credential.id)}`
    : "";
  const options = data.inventory.filter((n) =>
    `${n.name} ${n.group}`.toLowerCase().includes(nodeSearch.toLowerCase()),
  );
  const matched = data.inventory.filter(
    (n) => clients.includes(n.uuid) || groups.includes(n.group),
  );
  const title = { routes: "大陆线路", speed: "大陆测速", websites: "国际网站" }[
    kind
  ];
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("已复制");
    } catch {
      setError("复制失败，请手动选中文本复制。");
    }
  }
  return (
    <div className="network-form native-plan-panel">
      {!resourcesOnly && (
        <>
          <div className="network-config-intro">
            <span className="network-icon-tile">
              <Layers3 size={22} aria-hidden="true" />
            </span>
            <div>
              <strong>把网络观测交给定时计划</strong>
              <p>
                选用途、选范围、设时间。大陆测量点登记一次，供多台 VPS 复用。
              </p>
            </div>
          </div>
          <div
            className="native-config-tabs"
            role="group"
            aria-label="方案工作区"
          >
            <button
              type="button"
              aria-pressed={view === "plan"}
              onClick={() => setView("plan")}
            >
              <Plus size={15} aria-hidden="true" />
              {edit ? "编辑方案" : "创建方案"}
            </button>
            <button
              type="button"
              aria-pressed={view === "setup"}
              onClick={() => setView("setup")}
            >
              <Radio size={15} aria-hidden="true" />
              测量点接入
            </button>
            <button
              type="button"
              aria-pressed={view === "manage"}
              onClick={() => setView("manage")}
            >
              <Layers3 size={15} aria-hidden="true" />
              已有方案 <span>{data.policies.length}</span>
            </button>
          </div>
        </>
      )}
      {view === "plan" && (
        <>
          <nav className="native-steps" aria-label="配置步骤">
            {["监控用途", "测量点与范围", "时间与预览"].map((x, i) => (
              <button
                key={x}
                type="button"
                aria-current={step === i + 1 ? "step" : undefined}
                onClick={() => {
                  setStep(i + 1);
                  setPreview(null);
                }}
              >
                <span className="native-step-number">{i + 1}</span>
                <span>{x}</span>
              </button>
            ))}
          </nav>
          {step === 1 && (
            <section className="network-section">
              <NetworkSectionHeading
                icon={Layers3}
                title={edit ? "编辑检测用途" : "你想观察哪一类网络表现？"}
                description="每个方案专注一类测量，结果会自动归入实例详情的对应类别。"
              />
              <div className="native-purpose-grid">
                {(
                  [
                    {
                      id: "routes",
                      label: "大陆线路",
                      detail:
                        "分别测量大陆→VPS、VPS→大陆；公共样本和固定端点分开标注。",
                    },
                    {
                      id: "speed",
                      label: "大陆测速",
                      detail:
                        "授权大陆端连接 VPS，单连接与多连接、两个方向分别全速测量。",
                    },
                    {
                      id: "websites",
                      label: "国际网站",
                      detail:
                        "DNS、连接、TLS、首字节及 HTTP 响应，记录实际命中的 CDN 地址。",
                    },
                  ] as const
                ).map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    aria-pressed={kind === x.id}
                    onClick={() => {
                      setKind(x.id);
                      setDaily(x.id === "speed");
                      setMinutes(x.id === "routes" ? 60 : 15);
                      setPreview(null);
                    }}
                  >
                    <span className="native-purpose-icon">
                      {x.id === "routes" ? (
                        <Network size={22} aria-hidden="true" />
                      ) : x.id === "speed" ? (
                        <Gauge size={22} aria-hidden="true" />
                      ) : (
                        <Globe2 size={22} aria-hidden="true" />
                      )}
                      {kind === x.id && <Check size={15} aria-hidden="true" />}
                    </span>
                    <strong>{x.label}</strong>
                    <small>{x.detail}</small>
                  </button>
                ))}
              </div>
              <p className="network-help">
                报告保留 7 天详细记录和 90
                天每日汇总。旧工具计划和历史仍在“工具诊断与旧计划”中。
              </p>
              <label>
                方案名称（可选）
                <input
                  maxLength={100}
                  value={policyName}
                  placeholder={`例如：${title} · 晚间观测`}
                  onChange={(e) => {
                    setPolicyName(e.target.value);
                    setPreview(null);
                  }}
                />
              </label>
              <div className="network-form-footer">
                <span>
                  {title} · 已选 {matched.length} 台 VPS
                </span>
                <button
                  className="network-primary-button"
                  onClick={() => setStep(2)}
                >
                  选择测量点与 VPS <ArrowRight size={15} aria-hidden="true" />
                </button>
              </div>
            </section>
          )}
          {step === 2 && (
            <>
              {kind === "websites" ? (
                <section className="network-section">
                  <NetworkSectionHeading
                    icon={Globe2}
                    title="网站目标"
                    description="按网站 / API 与 CDN 分组选择，预设资源路径会自动带入。"
                  />
                  <WebsiteTargetPicker
                    catalog={data}
                    value={sites ?? data.websites.slice(0, 6)}
                    onChange={(value) => {
                      setSites(value);
                      setPreview(null);
                    }}
                  />
                  <details className="network-disclosure">
                    <summary>自定义网站目标</summary>
                    <label>
                      全部已选目标（域名，每行一个；最多 {data.websiteLimit}{" "}
                      个）
                      <textarea
                        value={(sites ?? data.websites.slice(0, 6)).join("\n")}
                        onChange={(e) => {
                          setSites(
                            e.target.value.trim()
                              ? e.target.value.split(/\s+/).filter(Boolean)
                              : null,
                          );
                          setPreview(null);
                        }}
                        placeholder="留空使用推荐的六个网站"
                      />
                    </label>
                  </details>
                  <p className="network-help">
                    HTTPS 使用正常 DNS；新探测器另对连接 IP 做 10 次 TCP
                    建连。401/403 等应用响应单独展示；附近 CDN
                    可达不能代表跨洲骨干互联。
                  </p>
                </section>
              ) : (
                <section className="network-section">
                  <NetworkSectionHeading
                    icon={Radio}
                    title="大陆测量点"
                    description="选择固定大陆端点，获得可对照的线路与速度样本。"
                  />
                  {kind === "routes" && (
                    <label className="network-check network-source-reference">
                      <input
                        type="checkbox"
                        checked={publicSources}
                        onChange={(e) => {
                          setPublicSources(e.target.checked);
                          setPreview(null);
                        }}
                      />
                      <span>
                        <strong>补充公共三网参考</strong>
                        <small>
                          Globalping 大陆去程 · NextTrace
                          北京三网回程；公共样本各自独立。
                        </small>
                      </span>
                    </label>
                  )}
                  <div className="native-check-grid">
                    {data.probes.map((p) => (
                      <label key={p.id}>
                        <input
                          type="checkbox"
                          checked={sources.includes(p.id)}
                          onChange={() => toggle(sources, p.id, setSources)}
                        />
                        <span>
                          <strong
                            className="network-choice-title"
                            title={p.name}
                          >
                            {p.name}
                          </strong>
                          <small>
                            {p.city} · {p.carrier}
                          </small>
                          <small>
                            {p.accessType} · {p.online ? "在线" : "离线"} ·{" "}
                            {p.publicAddress
                              ? "支持反向追踪"
                              : "未声明公网地址，回程可能缺失"}
                          </small>
                        </span>
                      </label>
                    ))}
                  </div>
                  {!data.probes.length && (
                    <div className="network-empty-state network-empty-compact">
                      <Radio size={24} aria-hidden="true" />
                      <strong>尚无自有大陆探针</strong>
                      <p>
                        公共探针可以测路径；全速测速需要接入你拥有或获授权的大陆设备。
                      </p>
                      <button type="button" onClick={() => setView("setup")}>
                        接入大陆测量点{" "}
                        <ArrowRight size={15} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                  {kind === "routes" && (
                    <details className="network-disclosure">
                      <summary>公共大陆探针当前覆盖</summary>
                      <p>
                        目录检查{" "}
                        {formatNetworkTime(
                          new Date(data.provider.checkedAt).toISOString(),
                        )}{" "}
                        · 本项目本小时已提交 {data.provider.used}/120
                        次；上游或共享出口额度可能更低。
                      </p>
                      <div className="native-public-coverage">
                        {["电信", "联通", "移动"].map((c, i) => {
                          const probes = data.provider.probes.filter(
                            (p) => p.location.asn === [4134, 4837, 9808][i],
                          );
                          return (
                            <article key={c}>
                              <strong>
                                {c} <small>AS{[4134, 4837, 9808][i]}</small>
                              </strong>
                              <b>
                                {probes.length} <small>个候选</small>
                              </b>
                              <p>
                                {[
                                  ...new Set(
                                    probes.map((p) => p.location.city),
                                  ),
                                ].join("、") || "当前无覆盖"}
                              </p>
                            </article>
                          );
                        })}
                      </div>
                      <p>{data.provider.error}</p>
                      <small>
                        目录地理位置和网络标签由提供方标记；每次报告保留实际返回的来源。三份公共去程与三份回程目标不是同一对端点。
                      </small>
                    </details>
                  )}
                </section>
              )}
              <section className="network-section">
                <NetworkSectionHeading
                  icon={HardDrive}
                  title="应用到哪些 VPS？"
                  description="指定 VPS 与所选分组取并集；从实例打开时已选中当前 VPS。"
                  aside={
                    <span className="network-badge">
                      {matched.length} 台已选
                    </span>
                  }
                />
                <label className="network-search-field">
                  <Search size={16} aria-hidden="true" />
                  <input
                    type="search"
                    aria-label="搜索网络方案 VPS"
                    placeholder="搜索 VPS 名称或分组"
                    value={nodeSearch}
                    onChange={(e) => setNodeSearch(e.target.value)}
                  />
                </label>
                <div className="network-selection-toolbar">
                  <span>
                    {options.length} 台匹配 · {data.inventory.length} 台总计
                  </span>
                  <div className="network-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setClients([
                          ...new Set([
                            ...clients,
                            ...options.map((n) => n.uuid),
                          ]),
                        ]);
                        setPreview(null);
                      }}
                    >
                      选择搜索结果
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setClients([]);
                        setGroups([]);
                        setPreview(null);
                      }}
                    >
                      清空选择
                    </button>
                  </div>
                </div>
                <div className="native-check-grid native-node-picker">
                  {options.map((n) => (
                    <label key={n.uuid}>
                      <input
                        type="checkbox"
                        checked={clients.includes(n.uuid)}
                        onChange={() => toggle(clients, n.uuid, setClients)}
                      />
                      <span>
                        <strong className="network-choice-title" title={n.name}>
                          {n.name}
                        </strong>
                        <small>{n.group || "未分组"}</small>
                      </span>
                    </label>
                  ))}
                </div>
                {!options.length && (
                  <p className="network-help">
                    没有匹配的 VPS，试试其他名称或分组。
                  </p>
                )}
                <details className="network-disclosure">
                  <summary>
                    按分组自动应用{" "}
                    {groups.length > 0 && `· 已选 ${groups.length} 组`}
                  </summary>
                  <div className="network-scope-groups">
                    {[
                      ...new Set(
                        data.inventory.map((n) => n.group).filter(Boolean),
                      ),
                    ].map((g) => (
                      <label key={g}>
                        <input
                          type="checkbox"
                          checked={groups.includes(g)}
                          onChange={() => toggle(groups, g, setGroups)}
                        />
                        {g}
                      </label>
                    ))}
                  </div>
                  <label className="network-check">
                    <input
                      type="checkbox"
                      checked={inherit}
                      onChange={(e) => {
                        setInherit(e.target.checked);
                        setPreview(null);
                      }}
                    />
                    分组自动继承，新加入的 VPS 下次到期时纳入检测
                  </label>
                </details>
                {data.inventoryError && (
                  <p role="alert">{data.inventoryError}</p>
                )}
              </section>
              <div className="network-form-footer">
                <span>
                  {title} · 已选 {matched.length} 台 VPS
                </span>
                <div className="network-actions">
                  <button onClick={() => setStep(1)}>上一步</button>
                  <button
                    className="network-primary-button"
                    onClick={() => {
                      setStep(3);
                      setPreview(null);
                    }}
                  >
                    设置时间并预览 <ArrowRight size={15} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </>
          )}
          {step === 3 && (
            <section className="network-section">
              <NetworkSectionHeading
                icon={Clock3}
                title="时间与测量条件"
                description="先预览实际覆盖与下次执行时间，再保存计划。"
              />
              <div className="native-field-grid">
                <label>
                  检测频率
                  <select
                    value={daily ? "daily" : "interval"}
                    onChange={(e) => {
                      setDaily(e.target.value === "daily");
                      setPreview(null);
                    }}
                  >
                    <option value="interval">固定间隔</option>
                    <option value="daily">每天多个指定时刻</option>
                  </select>
                </label>
                {daily ? (
                  <>
                    <label>
                      IANA 时区
                      <select
                        value={timezone}
                        onChange={(e) => {
                          setTimezone(e.target.value);
                          setPreview(null);
                        }}
                      >
                        {data.timezones.map((z) => (
                          <option key={z} value={z}>
                            {(
                              {
                                "Asia/Shanghai": "北京时间",
                                "Asia/Hong_Kong": "香港",
                                "Asia/Tokyo": "东京",
                                "Asia/Singapore": "新加坡",
                                "Europe/London": "伦敦",
                                "Europe/Berlin": "柏林",
                                "America/Los_Angeles": "洛杉矶",
                                "America/New_York": "纽约",
                                UTC: "协调世界时",
                              } as Record<string, string>
                            )[z] || z}{" "}
                            · {z}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="native-time-editor">
                      <strong>每日检测时刻</strong>
                      <div className="network-daily-time-list">
                        {times.map((time, i) => (
                          <label key={i}>
                            <span>时刻 {i + 1}</span>
                            <input
                              type="time"
                              aria-label={`每日检测时刻 ${i + 1}`}
                              value={time}
                              onChange={(e) => {
                                setTimes(
                                  times.map((t, at) =>
                                    at === i ? e.target.value : t,
                                  ),
                                );
                                setPreview(null);
                              }}
                            />
                            {times.length > 1 && (
                              <button
                                type="button"
                                aria-label={`移除每日检测时刻 ${i + 1}`}
                                onClick={() => {
                                  setTimes(times.filter((_, at) => at !== i));
                                  setPreview(null);
                                }}
                              >
                                ×
                              </button>
                            )}
                          </label>
                        ))}
                      </div>
                      <button
                        type="button"
                        disabled={times.length >= 8}
                        onClick={() => {
                          setTimes([...times, ""]);
                          setPreview(null);
                        }}
                      >
                        <Plus size={14} aria-hidden="true" />
                        添加时刻
                      </button>
                      <small>最多 8 个时刻，按所选时区执行。</small>
                    </div>
                  </>
                ) : (
                  <label>
                    间隔
                    <select
                      value={kind === "speed" ? 1440 : minutes}
                      onChange={(e) => {
                        setMinutes(Number(e.target.value));
                        setPreview(null);
                      }}
                    >
                      {(kind === "speed"
                        ? [1440]
                        : [5, 15, 30, 60, 360, 720, 1440]
                      ).map((m) => (
                        <option key={m} value={m}>
                          {m < 60 ? `${m} 分钟` : `${m / 60} 小时`}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  地址族
                  <select
                    value={family}
                    onChange={(e) => {
                      setFamily(e.target.value as "4" | "6");
                      setPreview(null);
                    }}
                  >
                    <option value="4">IPv4</option>
                    <option value="6">IPv6</option>
                  </select>
                </label>
                {kind === "routes" && (
                  <label>
                    路径协议
                    <select
                      value={protocol}
                      onChange={(e) => {
                        setProtocol(e.target.value as "tcp" | "icmp");
                        setPreview(null);
                      }}
                    >
                      <option value="tcp">TCP 443</option>
                      <option value="icmp">ICMP</option>
                    </select>
                  </label>
                )}
                {kind === "speed" && (
                  <>
                    <label>
                      每方向秒数
                      <input
                        type="number"
                        min={5}
                        max={20}
                        value={seconds}
                        onChange={(e) => {
                          setSeconds(Number(e.target.value));
                          setPreview(null);
                        }}
                      />
                    </label>
                    <label>
                      连接数
                      <select
                        value={streams.join(",")}
                        onChange={(e) => {
                          setStreams(e.target.value.split(",").map(Number));
                          setPreview(null);
                        }}
                      >
                        <option value="1,4">单连接＋4 连接</option>
                        <option value="1">仅单连接</option>
                        <option value="4">仅 4 连接</option>
                        <option value="1,8">单连接＋8 连接</option>
                      </select>
                    </label>
                  </>
                )}
              </div>
              {kind === "speed" && (
                <label className="network-check network-traffic-consent">
                  <input
                    type="checkbox"
                    checked={accepted}
                    onChange={(e) => {
                      setAccepted(e.target.checked);
                      setPreview(null);
                    }}
                  />
                  我有权使用所选大陆探针和 VPS，接受两端实际测速流量；TCP
                  不限速。
                </label>
              )}
              <div className="network-form-footer">
                <span>
                  {title} · {matched.length} 台 VPS
                </span>
                <div className="network-actions">
                  <button onClick={() => setStep(2)}>上一步</button>
                  <button
                    className="network-primary-button"
                    disabled={busy}
                    onClick={() =>
                      void action(async () =>
                        setPreview(await previewNative(draft)),
                      )
                    }
                  >
                    预览覆盖与下次执行
                  </button>
                </div>
              </div>
              {preview && (
                <div className="native-preview">
                  <p>
                    下次执行：
                    {formatNetworkTime(
                      new Date(preview.nextAt).toISOString(),
                    )}{" "}
                    · {preview.members.length} 台 VPS
                  </p>
                  {kind === "speed" && (
                    <p>
                      若两个方向均为 1 Gbit/s，所选连接配置每次约{" "}
                      {preview.trafficAt1GbpsGB.toFixed(2)} GB /
                      测量点，实际按结果字节计费。
                    </p>
                  )}
                  {preview.members.map((n) => (
                    <details
                      key={n.id}
                      className="native-preview-node"
                      open={
                        preview.members.length === 1 ||
                        n.jobs.some((j) => !j.ready)
                      }
                    >
                      <summary>
                        {data.inventory.find((x) => x.uuid === n.id)?.name ||
                          n.id}{" "}
                        · {n.jobs.length} 项
                      </summary>
                      {n.jobs.map((j, i) => (
                        <p key={i} data-ready={j.ready}>
                          {j.direction} ·{" "}
                          {j.source.carrier || j.source.provider} ·{" "}
                          {j.target || "未配置"} ·{" "}
                          {j.ready ? "可排队" : j.reason}
                        </p>
                      ))}
                    </details>
                  ))}
                  <button
                    className="network-primary-button"
                    disabled={busy || !preview.members.length}
                    onClick={() =>
                      void action(async () => {
                        await saveNative(draft);
                        setMessage("方案已保存；可在已有方案中立即执行。");
                        setView("manage");
                        setPreview(null);
                        setEdit(undefined);
                        setPolicyName("");
                      })
                    }
                  >
                    确认保存方案
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}
      {view === "setup" && (
        <>
          <section className="network-section native-setup-section">
            <NetworkSectionHeading
              icon={Radio}
              title="接入大陆测量点"
              description="登记一次，在大陆设备上运行一键命令，之后可供多个方案复用。"
            />
            <p>
              大陆探针是你拥有或获授权的 Linux systemd
              设备；城市和运营商为管理员声明。大陆探针使用独立的 systemd
              服务，可与本机 VPS 探测器共存。VPS 仍使用原来的 UUID 和密钥。
            </p>
            <div className="native-field-grid">
              <label>
                探针名称
                <input
                  value={probeName}
                  onChange={(e) => setProbeName(e.target.value)}
                />
              </label>
              <label>
                大陆城市
                <input value={city} onChange={(e) => setCity(e.target.value)} />
              </label>
              <label>
                运营商
                <select
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                >
                  {["电信", "联通", "移动", "其他"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                接入类型
                <select
                  value={access}
                  onChange={(e) => setAccess(e.target.value)}
                >
                  {["家庭宽带", "机房", "企业", "未知"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                可达公网地址（可选）
                <input
                  value={publicAddress}
                  onChange={(e) => setPublicAddress(e.target.value)}
                  placeholder="NAT 后可留空"
                />
              </label>
              <label>
                Komari 完整地址
                <input value={base} onChange={(e) => setBase(e.target.value)} />
              </label>
            </div>
            <button
              disabled={busy}
              onClick={() =>
                void action(async () =>
                  setCredential(
                    await registerProbe({
                      name: probeName,
                      city,
                      carrier,
                      accessType: access,
                      publicAddress,
                    }),
                  ),
                )
              }
            >
              生成大陆探针凭证
            </button>
            {credential && (
              <div className="network-credential-reveal">
                <strong>仅显示一次的探针密钥</strong>
                <code>{credential.token}</code>
                <pre>{command}</pre>
                <p>
                  复制命令到大陆设备执行，在隐藏的密钥提示中粘贴。不要把密钥加到命令参数中。
                </p>
                <div className="network-actions">
                  <button
                    type="button"
                    onClick={() => void copy(credential.token)}
                  >
                    <Copy size={14} aria-hidden="true" />
                    复制密钥
                  </button>
                  <button type="button" onClick={() => void copy(command)}>
                    <Copy size={14} aria-hidden="true" />
                    复制安装命令
                  </button>
                  <button onClick={() => setCredential(null)}>隐藏凭证</button>
                </div>
              </div>
            )}
            {data.probes.map((p) => (
              <div className="network-instance-plan" key={p.id}>
                <div>
                  <strong>{p.name}</strong>
                  <small>
                    {p.city} · {p.carrier} · {p.accessType}
                  </small>
                </div>
                <span
                  className="network-badge"
                  data-state={p.online ? "ok" : "missing"}
                >
                  {p.online ? "在线" : "待连接"}
                </span>
                <button
                  disabled={busy}
                  onClick={() => void action(() => revokeProbe(p.id))}
                >
                  撤销凭证
                </button>
              </div>
            ))}
          </section>
          <section className="network-section native-setup-section">
            <NetworkSectionHeading
              icon={HardDrive}
              title="VPS 连接目标"
              description="确认公网地址与临时测速端口；已读取的地址可直接使用。"
            />
            <p>
              测速时临时开放带认证的 iperf3 监听，任务结束或 240 秒后关闭。需在
              VPS 和云防火墙允许所选 TCP 端口，优先只允许大陆探针出口。IPv6
              计划需填写 IPv6 可达目标。
            </p>
            <label>
              VPS
              <select
                value={endpointUuid}
                onChange={(e) => {
                  setEndpointUuid(e.target.value);
                  setEndpoint(data.endpoints[e.target.value]?.address || "");
                  setPort(data.endpoints[e.target.value]?.port || 25201);
                }}
              >
                <option value="">选择 VPS</option>
                {data.inventory.map((n) => (
                  <option key={n.uuid} value={n.uuid}>
                    {n.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="native-field-grid">
              <label>
                公网 IP / 域名
                <input
                  value={
                    endpoint ?? data.endpoints[endpointUuid]?.address ?? ""
                  }
                  placeholder={
                    data.endpoints[endpointUuid]?.address || "VPS 可达地址"
                  }
                  onChange={(e) => setEndpoint(e.target.value)}
                />
              </label>
              <label>
                TCP 端口
                <input
                  type="number"
                  min={20000}
                  max={40000}
                  value={port ?? data.endpoints[endpointUuid]?.port ?? 25201}
                  onChange={(e) => setPort(Number(e.target.value))}
                />
              </label>
            </div>
            <button
              disabled={busy || !endpointUuid}
              onClick={() =>
                void action(() =>
                  nativeEndpoint(
                    endpointUuid,
                    endpoint ?? data.endpoints[endpointUuid]?.address ?? "",
                    port ?? data.endpoints[endpointUuid]?.port ?? 25201,
                  ),
                )
              }
            >
              保存连接目标
            </button>
          </section>
          {!resourcesOnly && (
            <div className="network-form-footer">
              <span>接入完成后回到方案继续配置</span>
              <button
                type="button"
                className="network-primary-button"
                onClick={() => setView("plan")}
              >
                返回方案配置 <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          )}
        </>
      )}
      {view === "manage" && (
        <section className="network-section native-management">
          <NetworkSectionHeading
            icon={Layers3}
            title="已有检测方案"
            description="编辑范围和时间，或立即运行一次。暂停方案会保留历史报告。"
            aside={
              <span className="network-badge">
                {data.policies.length} 个方案
              </span>
            }
          />
          {!data.policies.length && (
            <div className="network-empty-state">
              <Layers3 size={28} aria-hidden="true" />
              <strong>还没有检测方案</strong>
              <p>从推荐用途开始，为一台或多台 VPS 设置定时观测。</p>
              <button
                type="button"
                className="network-primary-button"
                onClick={() => {
                  setView("plan");
                  setStep(1);
                }}
              >
                创建第一个方案
              </button>
            </div>
          )}
          {data.policies.map((p) => (
            <article className="network-instance-plan" key={p.id}>
              <div>
                <strong>{p.name}</strong>
                <small>
                  {
                    {
                      routes: "大陆线路",
                      speed: "大陆测速",
                      websites: "国际网站",
                    }[p.kind]
                  }{" "}
                  · {p.clients.length} 台指定 VPS
                  {p.groups.length ? ` · ${p.groups.length} 个分组` : ""}
                </small>
                <small>
                  {p.enabled ? "启用" : "暂停"} · 下次{" "}
                  {formatNetworkTime(new Date(p.nextAt).toISOString())}
                </small>
              </div>
              <div className="network-actions">
                <button onClick={() => editing(p)}>编辑</button>
                <button
                  disabled={busy || !p.enabled}
                  onClick={() => void action(() => runNative(p.id))}
                >
                  立即执行
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(() =>
                      saveNative({
                        ...p,
                        revision: data.revision,
                        enabled: !p.enabled,
                      }),
                    )
                  }
                >
                  {p.enabled ? "暂停" : "恢复"}
                </button>
                <button
                  disabled={busy}
                  onClick={() => void action(() => removeNative(p.id))}
                >
                  删除
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
      {busy && <p role="status">正在提交…</p>}
      {error && (
        <p className="network-form-error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
