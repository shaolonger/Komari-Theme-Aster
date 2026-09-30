import { useState } from "react";
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
export function NativePlanPanel({
  initialNodes,
  primaryNode,
  onApplied,
}: {
  initialNodes: string[];
  primaryNode?: string;
  onApplied?: () => void;
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
    [sites, setSites] = useState<string[]>([]),
    [daily, setDaily] = useState(false),
    [times, setTimes] = useState("21:00"),
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
    [endpoint, setEndpoint] = useState(""),
    [port, setPort] = useState(25201);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      await cache.invalidateQueries({ queryKey: ["native-catalog"] });
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
      edit?.name ||
      {
        routes: "大陆双向线路",
        speed: "大陆双向测速",
        websites: "国际网站体验",
      }[kind],
    kind,
    clients,
    groups,
    sources,
    sites: sites.length ? sites : data.websites.slice(0, 6),
    family,
    protocol,
    seconds,
    streams,
    timing: daily
      ? {
          type: "daily",
          times: times.split(/[,，\s]+/).filter(Boolean),
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
      setTimes(p.timing.times.join(", "));
      setTimezone(p.timing.timezone);
    } else setMinutes(p.timing.minutes);
    setStep(1);
    setPreview(null);
  }
  const quote = (v: string) => "'" + v.replace(/'/g, "'\\''") + "'";
  const command = credential
    ? `curl -fsSL https://github.com/shaolonger/Komari-Theme-Aster/releases/latest/download/Aster-Network-Observatory-install.sh | sudo sh -s -- --server-url ${quote(base)} --probe-id ${quote(credential.id)}`
    : "";
  return (
    <div className="network-form native-plan-panel">
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
            {i + 1} · {x}
          </button>
        ))}
      </nav>
      {step === 1 && (
        <section className="network-section">
          <h3>{edit ? "编辑方案" : "选择监控用途"}</h3>
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
                <strong>{x.label}</strong>
                <small>{x.detail}</small>
              </button>
            ))}
          </div>
          <p className="network-help">
            报告保留 7 天详细记录和 90
            天每日汇总。旧工具计划和历史仍在“工具诊断与旧计划”中。
          </p>
          <button className="network-primary-button" onClick={() => setStep(2)}>
            选择测量点与 VPS →
          </button>
        </section>
      )}
      {step === 2 && (
        <>
          {kind === "websites" ? (
            <section className="network-section">
              <h3>网站目标</h3>
              <div className="native-check-grid">
                {data.websites.map((site) => (
                  <label key={site}>
                    <input
                      type="checkbox"
                      checked={(sites.length
                        ? sites
                        : data.websites.slice(0, 6)
                      ).includes(site)}
                      onChange={() =>
                        toggle(
                          sites.length ? sites : data.websites.slice(0, 6),
                          site,
                          setSites,
                        )
                      }
                    />
                    {site}
                  </label>
                ))}
              </div>
              <label>
                自定义网站（域名，每行一个；最多 24 个）
                <textarea
                  value={sites.join("\n")}
                  onChange={(e) =>
                    setSites(e.target.value.split(/\s+/).filter(Boolean))
                  }
                  placeholder="留空使用推荐的六个网站"
                />
              </label>
              <p className="network-help">
                网站体验使用正常 DNS；附近 CDN 可达不能代表美国或欧洲骨干互联。
              </p>
            </section>
          ) : (
            <section className="network-section">
              <h3>大陆测量点</h3>
              {kind === "routes" && (
                <label>
                  <input
                    type="checkbox"
                    checked={publicSources}
                    onChange={(e) => setPublicSources(e.target.checked)}
                  />
                  补充 Globalping 大陆公共去程与 NextTrace 北京三网回程参考
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
                      {p.city} · {p.carrier} · {p.name}
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
                <p className="network-inline-note">
                  尚无自有大陆探针。公共探针可以测路径，不能提供全速
                  iperf3；请在下方登记自己的大陆设备。
                </p>
              )}
              {kind === "routes" && (
                <details>
                  <summary>公共大陆探针当前覆盖</summary>
                  <p>
                    目录检查{" "}
                    {formatNetworkTime(
                      new Date(data.provider.checkedAt).toISOString(),
                    )}{" "}
                    · 本项目本小时已提交 {data.provider.used}/120
                    次；上游或共享出口额度可能更低。
                  </p>
                  {["电信", "联通", "移动"].map((c, i) => {
                    const probes = data.provider.probes.filter(
                      (p) => p.location.asn === [4134, 4837, 9808][i],
                    );
                    return (
                      <p key={c}>
                        {c} AS{[4134, 4837, 9808][i]} · {probes.length} 个候选 ·{" "}
                        {[...new Set(probes.map((p) => p.location.city))].join(
                          "、",
                        ) || "当前无覆盖"}
                      </p>
                    );
                  })}
                  <p>{data.provider.error}</p>
                  <small>
                    目录地理位置和网络标签由提供方标记；每次报告保留实际返回的来源。三份公共去程与三份回程目标不是同一对端点。
                  </small>
                </details>
              )}
            </section>
          )}
          <section className="network-section">
            <h3>应用范围</h3>
            <div className="native-check-grid">
              {data.inventory.map((n) => (
                <label key={n.uuid}>
                  <input
                    type="checkbox"
                    checked={clients.includes(n.uuid)}
                    onChange={() => toggle(clients, n.uuid, setClients)}
                  />
                  {n.name}
                </label>
              ))}
            </div>
            <details>
              <summary>按分组应用</summary>
              {[
                ...new Set(data.inventory.map((n) => n.group).filter(Boolean)),
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
              <label>
                <input
                  type="checkbox"
                  checked={inherit}
                  onChange={(e) => setInherit(e.target.checked)}
                />
                分组自动继承，新加入的 VPS 下次到期时纳入检测
              </label>
            </details>
            {data.inventoryError && <p role="alert">{data.inventoryError}</p>}
          </section>
          <div className="network-actions">
            <button onClick={() => setStep(1)}>上一步</button>
            <button
              className="network-primary-button"
              onClick={() => {
                setStep(3);
                setPreview(null);
              }}
            >
              设置时间并预览 →
            </button>
          </div>
        </>
      )}
      {step === 3 && (
        <section className="network-section">
          <h3>时间与测量条件</h3>
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
                <label>
                  每日时刻（逗号分隔）
                  <input
                    value={times}
                    onChange={(e) => {
                      setTimes(e.target.value);
                      setPreview(null);
                    }}
                    placeholder="03:00, 21:00"
                  />
                </label>
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
            <label>
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => {
                  setAccepted(e.target.checked);
                  setPreview(null);
                }}
              />
              我有权使用所选大陆探针和 VPS，接受两端实际测速流量；TCP 不限速。
            </label>
          )}
          <div className="network-actions">
            <button onClick={() => setStep(2)}>上一步</button>
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => setPreview(await previewNative(draft)))
              }
            >
              预览覆盖与下次执行
            </button>
          </div>
          {preview && (
            <div className="native-preview">
              <p>
                下次执行：
                {formatNetworkTime(
                  new Date(preview.nextAt).toISOString(),
                )} · {preview.members.length} 台 VPS
              </p>
              {kind === "speed" && (
                <p>
                  若两个方向均为 1 Gbit/s，所选连接配置每次约{" "}
                  {preview.trafficAt1GbpsGB.toFixed(2)} GB /
                  测量点，实际按结果字节计费。
                </p>
              )}
              {preview.members.map((n) => (
                <details key={n.id} open>
                  <summary>
                    {data.inventory.find((x) => x.uuid === n.id)?.name || n.id}{" "}
                    · {n.jobs.length} 项
                  </summary>
                  {n.jobs.map((j, i) => (
                    <p key={i} data-ready={j.ready}>
                      {j.direction} · {j.source.carrier || j.source.provider} ·{" "}
                      {j.target || "未配置"} · {j.ready ? "可排队" : j.reason}
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
                    setMessage("方案已保存；可在下方立即执行。");
                    setPreview(null);
                    setEdit(undefined);
                  })
                }
              >
                确认保存方案
              </button>
            </div>
          )}
        </section>
      )}
      <details className="network-section">
        <summary>测量点接入与 VPS 公网地址</summary>
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
            <select value={access} onChange={(e) => setAccess(e.target.value)}>
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
            <button onClick={() => setCredential(null)}>隐藏凭证</button>
          </div>
        )}
        {data.probes.map((p) => (
          <p key={p.id}>
            {p.name} · {p.city} {p.carrier}{" "}
            <button
              disabled={busy}
              onClick={() => void action(() => revokeProbe(p.id))}
            >
              撤销凭证
            </button>
          </p>
        ))}
        <h4>VPS 连接目标与临时测速端口</h4>
        <p>
          测速时临时开放带认证的 iperf3 监听，任务结束或 240 秒后关闭。需在 VPS
          和云防火墙允许所选 TCP 端口，优先只允许大陆探针出口。IPv6 计划需填写
          IPv6 可达目标。
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
              value={endpoint}
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
              value={port}
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
                endpoint || data.endpoints[endpointUuid]?.address || "",
                port,
              ),
            )
          }
        >
          保存连接目标
        </button>
      </details>
      <details className="network-section">
        <summary>管理原生方案 · {data.policies.length}</summary>
        {data.policies.map((p) => (
          <article className="network-instance-plan" key={p.id}>
            <div>
              <strong>{p.name}</strong>
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
      </details>
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
