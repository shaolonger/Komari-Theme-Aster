import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Layers3, Timer } from "lucide-react";
import {
  deleteReportSuite,
  previewReportSuite,
  reportCatalog,
  runReportSuite,
  saveReportSuite,
  type ReportDraft,
  type ReportModule,
  type ReportModuleConfig,
  type ReportSuite,
} from "@/services/reportObservatory";
import { NetworkSectionHeading } from "./NetworkUi";
import { reportLabels } from "./reportMetrics";
import { formatNetworkTime } from "./shared";
import "@/styles/network-reports.css";

export function ReportPlanPanel({
  uuid,
  initialNodes = [],
  onApplied,
}: {
  uuid?: string;
  initialNodes?: string[];
  onApplied?: () => void;
}) {
  const query = useQuery({
      queryKey: ["report-catalog"],
      queryFn: reportCatalog,
      refetchInterval: 30000,
    }),
    client = useQueryClient();
  const [draft, setDraft] = useState<ReportDraft | null>(null),
    [search, setSearch] = useState(""),
    [step, setStep] = useState(1),
    [preview, setPreview] = useState<Awaited<
      ReturnType<typeof previewReportSuite>
    > | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [dailyInputs, setDailyInputs] = useState<Record<string, string>>({});
  const catalog = query.data;
  if (!catalog)
    return (
      <div className="network-form">
        <p>{query.error?.message || "正在读取报告预设…"}</p>
      </div>
    );
  function forFamily(ids: string[], family: "4" | "6") {
    return [...new Set(ids.map(id => {
      const source = catalog!.endpoints.find(item => item.id === id);
      if (!source || source.family === "auto" || source.family === family) return id;
      return catalog!.endpoints.find(item => item.category === source.category && item.city === source.city && item.carrier === source.carrier && item.provider === source.provider && item.dc === source.dc && item.regionCode === source.regionCode && item.family === family)?.id || "";
    }).filter(Boolean))];
  }
  function presetModule(id: string): ReportModuleConfig {
    const preset = catalog!.presets.find((p) => p.id === id)!;
    return {
      module: preset.module,
      preset: preset.id,
      endpoints: [...preset.endpoints],
      family: preset.module === "nodequality-full" ? "auto" : "4",
      protocols: ["tcp"],
      sources: [],
      publicSources: preset.publicSources === true,
      seconds: 10,
      warmupSeconds: 2,
      streams: [1], samples: 10, packetSizes: [], maxTrafficMiB: 1024,
      ...(preset.module === "tcpquality-full" ? { profile: "AUTO" as const, timeoutMinutes: 120 } : {}),
      ...(preset.module === "nodequality-full" ? { checks: ["hardware_quality", "ip_quality", "net_quality", "backroute_trace"], hardwareMode: "standard" as const, networkMode: "standard" as const, timeoutMinutes: 120 } : {}),
      enabled: true,
      timing: preset.timing,
      nextAt: 0,
    };
  }
  const selectedSuite = catalog.suites.find(suite => suite.id === new URLSearchParams(window.location.search).get("suite"));
  const current = draft || (selectedSuite ? { ...selectedSuite, revision: catalog.revision } : null) || {
    name: "网络报告",
    clients: initialNodes.length ? initialNodes : uuid ? [uuid] : [],
    groups: [],
    inherit: true,
    enabled: true,
    trafficAccepted: false,
    modules: [presetModule("international-basic")],
    revision: catalog.revision,
  };
  function change(patch: Partial<ReportDraft>) {
    setDraft({ ...current, ...patch });
    setPreview(null);
  }
  function moduleChange(
    module: ReportModule,
    patch: Partial<ReportModuleConfig>,
    rawDaily?: string,
  ) {
    if (patch.timing)
      setDailyInputs((old) => {
        const updated = { ...old };
        if (rawDaily === undefined) delete updated[module];
        else updated[module] = rawDaily;
        return updated;
      });
    change({
      modules: current.modules.map((m) =>
        m.module === module ? { ...m, ...patch } : m,
      ),
    });
  }
  async function mutate(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      await client.invalidateQueries({ queryKey: ["report-catalog"] });
      await client.invalidateQueries({ queryKey: ["report-rounds"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  function edit(suite: ReportSuite) {
    setDraft({ ...suite, revision: catalog!.revision });
    setDailyInputs({});
    setPreview(null);
    setStep(1);
  }
  return (
    <div className="network-form report-plan-panel">
      <NetworkSectionHeading
        icon={Layers3}
        title="网络报告方案"
        description="选择模块、执行时间和 VPS；保存和执行操作直接写入网络插件。探测器与目标端点在网络观测中统一管理。"

      />
      <nav className="report-plan-steps" aria-label="配置步骤">
        {[
          [1, "模块与预设"],
          [2, "定时时间"],
          [3, "VPS 与覆盖"],
        ].map(([id, title]) => (
          <button
            key={id}
            type="button"
            aria-current={step === id ? "step" : undefined}
            onClick={() => setStep(Number(id))}
          >
            {id}. {title}
          </button>
        ))}
      </nav>
      <label>
        方案名称
        <input
          value={current.name}
          onChange={(e) => change({ name: e.target.value })}
        />
      </label>
      {step === 1 && (
        <>
          <p className="report-caption">
            国际基础可直接运行；路由与测速的大陆覆盖来自实际可用的公共服务或已登记测量点。
          </p>
          <div className="report-preset-grid">
            {catalog.presets.map((preset) => {
              const selected = current.modules.find(
                (m) => m.module === preset.module,
              );
              return (
                <button
                  type="button"
                  key={preset.id}
                  aria-pressed={selected?.preset === preset.id}
                  disabled={!catalog.modules.includes(preset.module)}
                  onClick={() =>
                    change({
                      modules: [
                        ...current.modules.filter(
                          (m) => m.module !== preset.module,
                        ),
                        presetModule(preset.id),
                      ],
                    })
                  }
                >
                  <strong>
                    {preset.name}
                    {selected?.preset === preset.id && <Check size={14} />}
                  </strong>
                  <small>
                    {preset.module === "tcpquality-full" ? "完整 TcpQuality · 长时任务" : preset.module === "nodequality-full" ? "完整 NodeQuality · 长时任务" : preset.traffic
                      ? "全速 · 需要授权资源"
                      : `${preset.endpoints.length} 个预设目标`}
                  </small>
                </button>
              );
            })}
          </div>
          <label>
            搜索测量目标
            <input
              placeholder="名称、地区、运营商或域名"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {current.modules.map((mod) => (
            <section className="report-plan-module" key={mod.module}>
              <div className="report-plan-module-heading">
                <h4>
                  {catalog.presets.find((p) => p.id === mod.preset)?.name ||
                    mod.module}
                </h4>
                <button
                  type="button"
                  onClick={() =>
                    change({
                      modules: current.modules.filter(
                        (m) => m.module !== mod.module,
                      ),
                    })
                  }
                >
                  移除模块
                </button>
              </div>
              {!(["tcpquality-full", "nodequality-full"] as string[]).includes(mod.module) && <div className="network-inline-fields">
                <label>
                  地址族
                  <select
                    value={mod.family}
                    onChange={(e) =>
                      moduleChange(mod.module, {
                        family: e.target.value as "4" | "6",
                        endpoints: forFamily(mod.endpoints, e.target.value as "4" | "6"),
                      })
                    }
                  >
                    <option value="4">IPv4</option>
                    <option value="6">IPv6</option>
                  </select>
                </label>
                {mod.module === "routes" && (
                  <label>
                    路由协议
                    <select
                      value={mod.protocols.join(",")}
                      onChange={(e) =>
                        moduleChange(mod.module, {
                          protocols: e.target.value.split(",") as (
                            | "tcp"
                            | "icmp"
                          )[],
                        })
                      }
                    >
                      <option value="tcp">TCP · 443</option>
                      <option value="icmp">ICMP</option>
                      <option value="tcp,icmp">TCP 与 ICMP 分开保存</option>
                    </select>
                  </label>
                )}
              </div>}
              {mod.module === "tcpquality-full" && <>
                <div className="network-inline-fields">
                  <label>执行档位<select value={mod.profile || "AUTO"} onChange={e => moduleChange(mod.module, { profile: e.target.value as "AUTO" | "FULL" | "LOWMEM" })}>
                    <option value="AUTO">自动 · 根据内存选择</option><option value="FULL">标准</option><option value="LOWMEM">低内存 · 单并发</option>
                  </select></label>
                  <label>超时上限<select value={mod.timeoutMinutes || 120} onChange={e => moduleChange(mod.module, { timeoutMinutes: Number(e.target.value) })}>
                    {[30, 60, 90, 120, 150].map(n => <option key={n} value={n}>{n} 分钟</option>)}
                  </select></label>
                </div>
                <p className="report-caption">执行完整 TcpQuality --all，低内存模式保持检测项目并降低并发。测试会下载并以 root 权限运行上游脚本，可能持续数小时，同一 VPS 的其他检测将在此期间排队；执行器保守要求临时目录至少 700 MiB 可用空间及挂载权限，受限容器可能无法运行。请避免与旧版定时脚本同时运行。报告长期保存，请关注面板磁盘空间。</p>
                <p className="report-caption">先升级面板的网络观测插件，再在已安装探测器的 VPS 上启用完整检测执行器；以下命令保留已有凭证。需要 bash、curl 和 util-linux 的 unshare。</p>
                <p className="report-caption">预览中执行器在线只表示服务可连接；实际执行还取决于容器权限、可用空间和上游服务。</p>
                <pre className="report-json">curl -fsSL https://github.com/shaolonger/Komari-Theme-Aster/releases/latest/download/Aster-Network-Observatory-install.sh | sudo sh -s -- --upgrade --enable-tcpquality-full</pre>
              </>}
              {mod.module === "nodequality-full" && <>
                <div className="network-inline-fields">
                  <label>地址族<select value={mod.family} onChange={e => moduleChange(mod.module, { family: e.target.value as "auto" | "4" | "6" })}><option value="auto">IPv4 与 IPv6</option><option value="4">仅 IPv4</option><option value="6">仅 IPv6</option></select></label>
                  <label>超时上限<select value={mod.timeoutMinutes || 120} onChange={e => moduleChange(mod.module, { timeoutMinutes: Number(e.target.value) })}>{[30, 60, 90, 120, 150, 180].map(n => <option key={n} value={n}>{n} 分钟</option>)}</select></label>
                </div>
                <div className="network-inline-fields">
                  <label>硬件测试模式<select value={mod.hardwareMode || "standard"} onChange={e => moduleChange(mod.module, { hardwareMode: e.target.value as "standard" | "fast" | "deep" })}><option value="standard">标准</option><option value="fast">快速</option><option value="deep">深度</option></select></label>
                  <label>网络测试模式<select value={mod.networkMode || "standard"} onChange={e => moduleChange(mod.module, { networkMode: e.target.value as "standard" | "low-data" })}><option value="standard">标准</option><option value="low-data">低流量</option></select></label>
                </div>
                <div className="network-inline-fields">{([['hardware_quality', '硬件性能'], ['ip_quality', 'IP 质量'], ['net_quality', '网络质量'], ['backroute_trace', '回程路由']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={(mod.checks || []).includes(key)} onChange={e => moduleChange(mod.module, { checks: e.target.checked ? [...(mod.checks || []), key] : (mod.checks || []).filter(c => c !== key) })} /> {label}</label>)}</div>
                <p className="report-caption">上游脚本以 root 下载并运行 BenchOS 和检测程序，报告会上传到 NodeQuality 第三方服务并生成可访问链接；测试可能占用大量 CPU、带宽和磁盘。请勿在资源不足或不允许上传数据的 VPS 上启用。容器需要挂载权限，执行目录至少需要 1.5 GiB 可用空间；报告与原始输出会保存在面板。</p>
                <p className="report-caption">先升级插件，再在目标 VPS 上执行下列命令，升级并启用完整检测执行器（保留原有凭证）：</p>
                <pre className="report-json">curl -fsSL https://github.com/shaolonger/Komari-Theme-Aster/releases/latest/download/Aster-Network-Observatory-install.sh | sudo sh -s -- --upgrade --enable-tcpquality-full</pre>
              </>}
              {mod.module === "tcp-quality" && <div className="network-inline-fields">
                <label>完整 TCP 建连样本<select value={mod.samples || 10} onChange={e => moduleChange(mod.module, { samples: Number(e.target.value) })}>
                  {[3, 5, 10].map(n => <option key={n} value={n}>{n} 次</option>)}
                </select></label>
                <label>可选 SYN 载荷比较<select value={(mod.packetSizes || []).join(",")} onChange={e => moduleChange(mod.module, { packetSizes: e.target.value ? e.target.value.split(",").map(Number) : [] })}>
                  <option value="">仅完整 TCP 建连</option><option value="0">原始 SYN · 0 B</option><option value="0,512,1200">原始 SYN · 0 / 512 / 1200 B</option>
                </select></label>
                <p className="report-caption">SYN 比较需要探测器安装 nping 及 CAP_NET_RAW；未响应率不等同于业务丢包，包长结果不认证 MTU。不可用时注明原因。</p>
              </div>}
              {mod.module === "routes" && <p className="report-caption">目标名称表示目的网络，不强制选路。默认京沪广三网 9 点；增加 CN2/9929/CMIN2 可比较不同目的网络。公共去程仅按实际国家与 ASN 匹配，不承诺京沪广对称覆盖。</p>}
              {["tcpquality-full", "nodequality-full"].includes(mod.module) ? null : mod.module === "bgp" ? (
                <p className="report-caption">
                  使用此 VPS 登记的公网 IPv4/IPv6 自动查询实际宣告前缀。公开 BGP
                  数据按来源保存；同前缀共享 55 分钟缓存。
                </p>
              ) : (
                <>
                  <div className="report-target-actions">
                    <button
                      type="button"
                      onClick={() =>
                        moduleChange(mod.module, {
                          endpoints: forFamily(presetModule(mod.preset!).endpoints, mod.family === "6" ? "6" : "4"),
                        })
                      }
                    >
                      恢复预设目标
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        moduleChange(mod.module, { endpoints: [] })
                      }
                    >
                      清空目标
                    </button>
                    <span>已选 {mod.endpoints.length}</span>
                  </div>
                  <div className="report-target-checklist">
                    {catalog.endpoints
                      .filter(
                        (e) =>
                          ((mod.module === "tcp-quality" ? e.uses.some(use => ["tcp-quality", "latency"].includes(use)) : mod.module === "routes"
                            ? e.uses.includes("route")
                            : mod.module.endsWith("speed")
                              ? e.uses.includes("speed")
                              : mod.module === "idc"
                                ? e.category === "idc"
                                : [
                                    "aws",
                                    "websites",
                                    "cdn",
                                    "telegram",
                                  ].includes(e.category)) ||
                            mod.endpoints.includes(e.id)) &&
                          [e.name, e.city, e.carrier, e.address, e.provider]
                            .join(" ")
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                      )
                      .map((endpoint) => (
                        <label key={endpoint.id}>
                          <input
                            type="checkbox"
                            disabled={endpoint.family !== "auto" && endpoint.family !== mod.family}
                            checked={mod.endpoints.includes(endpoint.id)}
                            onChange={(e) =>
                              moduleChange(mod.module, {
                                endpoints: e.target.checked
                                  ? [...mod.endpoints, endpoint.id]
                                  : mod.endpoints.filter(
                                      (id) => id !== endpoint.id,
                                    ),
                              })
                            }
                          />
                          <span>
                            <strong>{endpoint.name}</strong>
                            <small>
                              {endpoint.provider} ·{" "}
                              {endpoint.city ||
                                endpoint.regionCode ||
                                endpoint.category}{" "}
                              ·{" "}
                              {endpoint.family === "auto"
                                ? "解析时确认地址族"
                                : "IPv" + endpoint.family}
                            </small>
                          </span>
                        </label>
                      ))}
                  </div>
                </>
              )}
              {mod.module.endsWith("speed") && (
                <>
                  {mod.endpoints.some(id => id.startsWith("taier:")) && <>
                    <p className="report-caption">公共测速由 VPS 主动连接，无需大陆自建测量机；严格匹配实际城市/运营商，缺少覆盖会明确记录。第三方协议和节点可能变化；队列串行执行并在繁忙时退避。</p>
                    <label>每测量点应用载荷上限（含所有方向、连接数和预热）<select value={mod.maxTrafficMiB || 1024} onChange={e => moduleChange(mod.module, { maxTrafficMiB: Number(e.target.value) })}>
                      {[64, 256, 512, 1024, 2048, 4096].map(n => <option value={n} key={n}>{n} MiB</option>)}
                    </select></label>
                    <p className="report-caption">达到上限提前结束并注明原因；协议开销另计。当前每 VPS 每次最多 {(mod.endpoints.filter(id => id.startsWith("taier:")).length * (mod.maxTrafficMiB || 1024) / 1024).toFixed(1)} GiB 应用载荷。</p>
                  </>}
                  <div className="network-inline-fields">
                    <label>
                      有效测速时长
                      <select
                        value={mod.seconds}
                        onChange={(e) =>
                          moduleChange(mod.module, {
                            seconds: Number(e.target.value),
                          })
                        }
                      >
                        {[5, 10, 15, 20].map((v) => (
                          <option key={v} value={v}>
                            {v} 秒
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      预热
                      <select
                        value={mod.warmupSeconds}
                        onChange={(e) =>
                          moduleChange(mod.module, {
                            warmupSeconds: Number(e.target.value),
                          })
                        }
                      >
                        <option value={2}>2 秒</option>
                        <option value={0}>无预热</option>
                      </select>
                    </label>
                    <label>
                      连接数
                      <select
                        value={mod.streams.join(",")}
                        onChange={(e) =>
                          moduleChange(mod.module, {
                            streams: e.target.value.split(",").map(Number),
                          })
                        }
                      >
                        <option value="1">单连接 P1</option>
                        <option value="1,4">
                          P1 与 P4 独立测试 · iperf3 / 公共测速
                        </option>
                        <option value="1,8">
                          P1 与 P8 独立测试 · iperf3 / 公共测速
                        </option>
                      </select>
                    </label>
                  </div>
                  <label className="report-checkbox">
                    <input
                      type="checkbox"
                      checked={current.trafficAccepted}
                      onChange={(e) =>
                        change({ trafficAccepted: e.target.checked })
                      }
                    />
                    确认全速流量：1 Gbit/s 每个端点、每个连接数、双向约{" "}
                    {((mod.seconds + mod.warmupSeconds) / 4).toFixed(1)}{" "}
                    GB；实际可更高
                  </label>
                </>
              )}
              {(mod.module === "routes" || mod.module.endsWith("speed")) && (
                <>
                  <label
                    className="report-checkbox"
                    hidden={mod.module !== "routes"}
                  >
                    <input
                      type="checkbox"
                      checked={mod.publicSources}
                      onChange={(e) =>
                        moduleChange(mod.module, {
                          publicSources: e.target.checked,
                        })
                      }
                    />
                    加入三网公共去程 MTR（实际覆盖与来源独立记录）
                  </label>
                  <fieldset>
                    <legend>固定测量点 · NAT 设备可发起双向测速</legend>
                    {catalog.probes.length ? (
                      catalog.probes.map((probe) => (
                        <label className="report-checkbox" key={probe.id}>
                          <input
                            type="checkbox"
                            checked={mod.sources.includes(probe.id)}
                            onChange={(e) =>
                              moduleChange(mod.module, {
                                sources: e.target.checked
                                  ? [...mod.sources, probe.id]
                                  : mod.sources.filter((id) => id !== probe.id),
                              })
                            }
                          />
                          {probe.city} {probe.carrier} · {probe.name} ·{" "}
                          {probe.online ? "在线" : "离线"}
                        </label>
                      ))
                    ) : (
                      <p className="report-caption">
                        尚无固定测量点；公开目录可以先运行，九格缺少资源的位置会注明原因。
                      </p>
                    )}
                  </fieldset>
                </>
              )}
            </section>
          ))}
        </>
      )}
      {step === 2 && (
        <>
          {current.modules.map((mod) => (
            <section className="report-plan-module" key={mod.module}>
              <NetworkSectionHeading
                icon={Timer}
                title={
                  catalog.presets.find((p) => p.id === mod.preset)?.name ||
                  mod.module
                }
                description="各模块独立调度；测速不会随延迟测试的频率触发。"
              />
              <label>
                执行方式
                <select
                  value={mod.timing.type}
                  onChange={(e) =>
                    moduleChange(mod.module, {
                      timing:
                        e.target.value === "daily"
                          ? {
                              type: "daily",
                              times: ["21:00"],
                              timezone: "Asia/Shanghai",
                            }
                          : {
                              type: "interval",
                              minutes: ["tcpquality-full", "nodequality-full"].includes(mod.module) ? 1440 : mod.module.endsWith("speed")
                                ? 1440
                                : mod.module === "routes" ||
                                    mod.module === "bgp"
                                  ? 360
                                  : 30,
                            },
                    })
                  }
                >
                  <option value="interval">固定间隔</option>
                  <option value="daily">每天指定时刻</option>
                </select>
              </label>
              {mod.timing.type === "interval" ? (
                <label>
                  检测间隔
                  <select
                    value={mod.timing.minutes}
                    onChange={(e) =>
                      moduleChange(mod.module, {
                        timing: {
                          type: "interval",
                          minutes: Number(e.target.value),
                        },
                      })
                    }
                  >
                    {(["tcpquality-full", "nodequality-full"].includes(mod.module) ? [60, 120, 180, 240, 360, 480, 720, 1440] : mod.module.endsWith("speed")
                      ? [1440]
                      : mod.module === "bgp"
                        ? [60, 360, 720, 1440]
                        : [5, 15, 30, 60, 360, 720, 1440]
                    ).map((m) => (
                      <option key={m} value={m}>
                        {m < 60 ? `每 ${m} 分钟` : `每 ${m / 60} 小时`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <label>
                    时区
                    <select
                      value={mod.timing.timezone}
                      onChange={(e) =>
                        moduleChange(mod.module, {
                          timing: {
                            type: "daily",
                            timezone: e.target.value,
                            times:
                              mod.timing.type === "daily"
                                ? mod.timing.times
                                : [],
                          },
                        })
                      }
                    >
                      {catalog.timezones.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    每天时刻 · 最多八个
                    <input
                      value={
                        dailyInputs[mod.module] ?? mod.timing.times.join(", ")
                      }
                      placeholder="04:00, 21:00"
                      onChange={(e) =>
                        moduleChange(
                          mod.module,
                          {
                            timing: {
                              type: "daily",
                              timezone:
                                mod.timing.type === "daily"
                                  ? mod.timing.timezone
                                  : "Asia/Shanghai",
                              times: e.target.value
                                .split(/[,，\s]+/)
                                .filter(Boolean),
                            },
                          },
                          e.target.value,
                        )
                      }
                    />
                  </label>
                  <p className="report-caption">
                    采用该 IANA
                    时区的实际日期与夏令时规则；同一时刻的重复输入会去重。
                  </p>
                </>
              )}
              {["tcpquality-full", "nodequality-full"].includes(mod.module) && <p className="report-caption">如果上一轮仍在运行，重叠的定时轮次会记录为跳过；建议间隔大于单次检测的超时时间。</p>}
            </section>
          ))}
        </>
      )}
      {step === 3 && (
        <>
          <fieldset>
            <legend>执行 VPS</legend>
            <div className="report-target-actions">
              <button
                type="button"
                onClick={() =>
                  change({ clients: catalog.inventory.map((n) => n.uuid) })
                }
              >
                全选 VPS
              </button>
              <button
                type="button"
                onClick={() => change({ clients: uuid ? [uuid] : [] })}
              >
                {uuid ? "仅当前 VPS" : "清空"}
              </button>
            </div>
            <div className="report-target-checklist">
              {catalog.inventory.map((node) => (
                <label key={node.uuid}>
                  <input
                    type="checkbox"
                    checked={current.clients.includes(node.uuid)}
                    onChange={(e) =>
                      change({
                        clients: e.target.checked
                          ? [...current.clients, node.uuid]
                          : current.clients.filter((id) => id !== node.uuid),
                      })
                    }
                  />
                  <span>
                    {node.name}
                    <small>{node.group || "未分组"}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>按分组继承新 VPS</legend>
            {[
              ...new Set(catalog.inventory.map((n) => n.group).filter(Boolean)),
            ].map((group) => (
              <label className="report-checkbox" key={group}>
                <input
                  type="checkbox"
                  checked={current.groups.includes(group)}
                  onChange={(e) =>
                    change({
                      groups: e.target.checked
                        ? [...current.groups, group]
                        : current.groups.filter((g) => g !== group),
                    })
                  }
                />
                {group}
              </label>
            ))}
            <label className="report-checkbox">
              <input
                type="checkbox"
                checked={current.inherit}
                onChange={(e) => change({ inherit: e.target.checked })}
              />
              自动跟随分组成员变化
            </label>
          </fieldset>
          <button
            disabled={busy}
            onClick={() =>
              void mutate(async () =>
                setPreview(await previewReportSuite(current)),
              )
            }
          >
            预览每台 VPS 的覆盖与累计容量
          </button>
          {preview && (
            <section className="report-coverage-preview">
              {preview.exceedsCapacity && (
                <p role="alert">
                  累计频率超过采集容量，保存前请减少目标或降低频率。
                </p>
              )}
              {preview.nodes.map((node) => (
                <details key={node.uuid}>
                  <summary>
                    {node.name} · 每日 {node.capacity.measurementsPerDay} 项测量
                    / {node.capacity.samplesPerDay} 次建连 · 测速{" "}
                    {Math.round(node.capacity.speedSecondsPerDay / 60)} 分钟/天
                  </summary>
                  <p>
                    以 1 Gbit/s 作量级估算约{" "}
                    {(node.capacity.speedSecondsPerDay / 8).toFixed(1)}{" "}
                    GB/天，实际按本轮字节记录；预热已计入时间。
                  </p>
                  {node.modules.map((mod) => (
                    <div key={mod.module}>
                      <h4>
                        {reportLabels[mod.module]} · 当前可确认{" "}
                        {mod.targets.filter((t) => t.ready).length}/
                        {mod.expected} · 下次{" "}
                        {formatNetworkTime(new Date(mod.nextAt).toISOString())}
                      </h4>
                      <p>
                        按当前并发与时长估算约{" "}
                        {Math.ceil(mod.estimatedQueueSeconds)}{" "}
                        秒；第三方目录发现、额度和端点繁忙可能延长等待。
                      </p>
                      {mod.targets
                        .filter((t) => !t.ready)
                        .map((t) => (
                          <p key={t.slotId}>
                            {t.source.city} {t.source.carrier}{" "}
                            {t.target || t.slotId}：{t.reason}
                          </p>
                        ))}
                    </div>
                  ))}
                </details>
              ))}
            </section>
          )}
        </>
      )}
      {current.revision !== catalog.revision && (
        <p role="alert">
          配置已被更新。请核对新的目录及方案后
          <button onClick={() => change({ revision: catalog.revision })}>
            重新预览当前编辑内容
          </button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="report-plan-footer">
        {step > 1 && <button onClick={() => setStep(step - 1)}>上一步</button>}
        {step < 3 ? (
          <button
            disabled={!current.modules.length}
            onClick={() => setStep(step + 1)}
          >
            下一步
          </button>
        ) : (
          <button
            disabled={busy || !preview || preview.exceedsCapacity}
            onClick={() =>
              void mutate(async () => {
                await saveReportSuite(current);
                setDraft(null);
                setDailyInputs({});
                setPreview(null);
                setMessage("报告方案已保存到网络插件");
                onApplied?.();
              })
            }
          >
            保存报告方案
          </button>
        )}
      </div>
      {!!catalog.suites.length && (
        <details>
          <summary>已保存方案 · {catalog.suites.length}</summary>
          {catalog.suites.map((suite) => (
            <div key={suite.id} className="report-saved-suite">
              <strong>{suite.name}</strong>
              <small>
                {suite.modules.map((m) => reportLabels[m.module]).join(" / ")} ·{" "}
                {suite.enabled ? reportLabels.ok : "已暂停"}
              </small>
              <div>
                <button onClick={() => edit(suite)}>编辑</button>
                <button
                  disabled={busy || !suite.enabled}
                  onClick={() => void mutate(() => runReportSuite(suite.id))}
                >
                  全部立即检测
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void mutate(() =>
                      saveReportSuite({
                        ...suite,
                        enabled: !suite.enabled,
                        revision: catalog.revision,
                      }),
                    )
                  }
                >
                  {suite.enabled ? "暂停" : "启用"}
                </button>
                <button
                  disabled={busy}
                  onClick={() => void mutate(() => deleteReportSuite(suite.id))}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
