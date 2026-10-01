import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Layers3, Radio, Timer } from "lucide-react";
import {
  applyReportMigrations,
  previewReportMigrations,
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
  onResources,
  onApplied,
}: {
  uuid?: string;
  initialNodes?: string[];
  onResources: () => void;
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
    [busy, setBusy] = useState(false);
  const [migrationIds, setMigrationIds] = useState<string[]>([]);
  const [migration, setMigration] = useState<Awaited<
    ReturnType<typeof previewReportMigrations>
  > | null>(null);
  const [dailyInputs, setDailyInputs] = useState<Record<string, string>>({});
  const catalog = query.data;
  if (!catalog)
    return (
      <div className="network-form">
        <p>{query.error?.message || "正在读取报告预设…"}</p>
      </div>
    );
  function presetModule(id: string): ReportModuleConfig {
    const preset = catalog!.presets.find((p) => p.id === id)!;
    return {
      module: preset.module,
      preset: preset.id,
      endpoints: [...preset.endpoints],
      family: "4",
      protocols: ["tcp"],
      sources: [],
      publicSources: preset.publicSources === true,
      seconds: 10,
      warmupSeconds: 2,
      streams: [1],
      enabled: true,
      timing: preset.timing,
      nextAt: 0,
    };
  }
  const current = draft || {
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
        description="选择模块、执行时间和 VPS；端点及条件随每轮保存。"
        aside={
          <button onClick={onResources}>
            <Radio size={15} />
            测量资源
          </button>
        }
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
                    {preset.traffic
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
              <div className="network-inline-fields">
                <label>
                  地址族
                  <select
                    value={mod.family}
                    onChange={(e) =>
                      moduleChange(mod.module, {
                        family: e.target.value as "4" | "6",
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
              </div>
              {mod.module === "bgp" ? (
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
                          endpoints: presetModule(mod.preset!).endpoints,
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
                          ((mod.module === "routes"
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
                          P1 与 P4 独立测试 · 仅 iperf3
                        </option>
                        <option value="1,8">
                          P1 与 P8 独立测试 · 仅 iperf3
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
                              minutes: mod.module.endsWith("speed")
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
                    {(mod.module.endsWith("speed")
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
                onApplied?.();
              })
            }
          >
            保存报告方案
          </button>
        )}
      </div>
      {!!catalog.legacyPolicies.filter((p) => !p.migratedSuiteId).length && (
        <details>
          <summary>批量迁移旧版集中方案 · 预览后停用旧触发</summary>
          <div className="report-target-actions">
            <button
              onClick={() => {
                setMigrationIds(
                  catalog.legacyPolicies
                    .filter((p) => !p.migratedSuiteId)
                    .map((p) => p.id),
                );
                setMigration(null);
              }}
            >
              全选旧方案
            </button>
            <button
              onClick={() => {
                setMigrationIds([]);
                setMigration(null);
              }}
            >
              清空
            </button>
          </div>
          {catalog.legacyPolicies
            .filter((p) => !p.migratedSuiteId)
            .map((p) => (
              <label key={p.id} className="report-checkbox">
                <input
                  type="checkbox"
                  checked={migrationIds.includes(p.id)}
                  onChange={(e) => {
                    setMigrationIds(
                      e.target.checked
                        ? [...migrationIds, p.id]
                        : migrationIds.filter((id) => id !== p.id),
                    );
                    setMigration(null);
                  }}
                />
                {p.name} · {p.enabled ? "启用中" : "已暂停"}
              </label>
            ))}
          <button
            disabled={busy || !migrationIds.length}
            onClick={() =>
              void mutate(async () =>
                setMigration(await previewReportMigrations(migrationIds)),
              )
            }
          >
            预览所选 {migrationIds.length} 个旧方案
          </button>
          {migration && (
            <>
              <section className="report-coverage-preview">
                <p>
                  确认后关闭所选旧计划的触发；旧报告仍可读取。新方案累计容量已一并计算。
                </p>
                {migration.exceedsCapacity && (
                  <p role="alert">
                    迁移范围超过资源或累计采集容量；请减少范围或先调整旧计划。
                  </p>
                )}
                {migration.migrations.map((item) => (
                  <details key={item.legacyId} open>
                    <summary>
                      {item.suite.name} · {item.coverage.nodes.length} 台 VPS ·
                      新增 {item.additional.length} 个目标
                    </summary>
                    {item.differences.map((d) => (
                      <p key={d}>{d}</p>
                    ))}
                    {item.coverage.nodes.map((n) => (
                      <p key={n.uuid}>
                        {n.name}：
                        {n.modules
                          .map(
                            (m) =>
                              `${reportLabels[m.module]} 当前可确认 ${m.targets.filter((t) => t.ready).length}/${m.expected}`,
                          )
                          .join(" / ")}{" "}
                        · 累计 {n.capacity.samplesPerDay} 次建连/天
                      </p>
                    ))}
                  </details>
                ))}
              </section>
              <button
                disabled={
                  busy ||
                  migration.exceedsCapacity ||
                  migration.revision !== catalog.revision
                }
                onClick={() =>
                  void mutate(async () => {
                    await applyReportMigrations(
                      migration.migrations.map((m) => m.legacyId),
                      migration.revision,
                    );
                    setMigration(null);
                    setMigrationIds([]);
                  })
                }
              >
                迁移所选方案并停用旧触发
              </button>
            </>
          )}
        </details>
      )}
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
