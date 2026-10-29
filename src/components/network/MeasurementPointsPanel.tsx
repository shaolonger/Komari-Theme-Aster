import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  nativeCatalog,
  nativeEndpoint,
  registerProbe,
  revokeProbe,
  issueNodeToken,
  revokeNodeToken,
  setWorkerUpdatePolicy,
} from "@/services/nativeObservatory";
import { formatNetworkTime, installCommand } from "./shared";
import { NetworkDrawer } from "./NetworkDrawer";
import { NodeSwitcher } from "@/components/instance/NodeSwitcher";

export function MeasurementPointsPanel({
  initialNodes = [],
}: {
  initialNodes?: string[];
}) {
  const query = useQuery({
    queryKey: ["measurement-points"],
    queryFn: nativeCatalog,
    refetchInterval: 15000,
    retry: false,
  });
  const cache = useQueryClient();
  const [uuid, setUuid] = useState(initialNodes[0] || ""),
    [address, setAddress] = useState<string | null>(null),
    [ipv4, setIpv4] = useState<string | null>(null),
    [ipv6, setIpv6] = useState<string | null>(null),
    [port, setPort] = useState<number | null>(null);
  const [probe, setProbe] = useState({
    name: "",
    city: "",
    carrier: "电信",
    accessType: "家庭宽带",
    publicAddress: "",
  });
  const [credential, setCredential] = useState<{
    id: string;
    token: string;
    role: "node" | "probe";
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [base, setBase] = useState(window.location.origin);
  const [profile, setProfile] = useState("preserve");
  const [confirm, setConfirm] = useState<"reset" | "revoke" | null>(null);
  const [probeToRevoke, setProbeToRevoke] = useState<string | null>(null);
  const data = query.data,
    selected = uuid || data?.inventory[0]?.uuid || "",
    endpoint = data?.endpoints[selected];
  async function act(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["measurement-points"] }),
        cache.invalidateQueries({ queryKey: ["report-catalog"] }),
      ]);
      setMessage(success);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <p role="status">
        {query.error?.message || "正在读取探测器与测量点…"}
        <button onClick={() => void query.refetch()}>重试</button>
      </p>
    );
  const command = credential ? installCommand(credential.id, base, { role: credential.role }) : "";
  const registered = data.registeredNodes.includes(selected);
  const node = data.inventory.find(n => n.uuid === selected);
  const worker = data.workers["node:" + selected];
  const online = worker && Date.now() - worker.seenAt < 90000;
  const maintenanceCommand = installCommand(selected, base, { upgrade: registered, profile: registered ? "preserve" : profile === "preserve" ? "auto" : profile });
  async function issue() {
    await act(async () => {
      const c = await issueNodeToken(selected);
      setCredential({ id: c.uuid, token: c.token, role: "node" });
      setConfirm(null);
    }, registered ? "新凭证已生成，旧凭证已失效；请在对应 VPS 写入新密钥" : "接入凭证已生成，请在对应 VPS 执行安装命令并输入密钥");
  }
  const featureNames: Record<string, string> = { "report-v3": "成组报告", "latency-samples": "延迟采样", "full-mtr": "逐跳路由", "speed-intervals": "测速分段", "http-speed": "HTTP 测速", "tcp-quality": "TCP 质量", "public-speed": "公共测速" };
  return (
    <div className="network-form measurement-points-panel">
      <p className="measurement-intro">
        在 VPS
        上运行探测器，采集回程、延迟和测速。大陆测量点用于去程及双向测速，可供多个方案复用。公共
        Globalping 覆盖由每轮实际发现确认。
      </p>
      {data.inventoryError && (
        <p role="alert">清单刷新失败：{data.inventoryError}</p>
      )}
      <label>
        Komari 完整地址
        <input value={base} onChange={(e) => setBase(e.target.value)} />
      </label>
      <NodeSwitcher className="measurement-node-switcher" label="VPS" nodes={data.inventory} currentUuid={selected} onSelect={(next) => {
        setUuid(next);
        setAddress(null);
        setIpv4(null);
        setIpv6(null);
        setPort(null);
        setCredential(null);
        setConfirm(null);
      }} />
      <div className="measurement-layout">
      <section className="network-section measurement-agent">
        <h3>VPS 探测器</h3>
        <div className="measurement-status"><strong>{node?.name || "请选择 VPS"}</strong><span data-online={!!online}>{online ? "在线" : worker ? "离线" : registered ? "等待连接" : "未接入"}</span></div>
        <dl className="measurement-facts"><div><dt>当前版本</dt><dd>{worker?.version || "尚未上报"}</dd></div><div><dt>最后连接</dt><dd>{worker ? formatNetworkTime(worker.seenAt) : "尚无记录"}</dd></div><div><dt>建议版本</dt><dd>{data.runnerRelease?.version || "更新插件后可查看"}</dd></div></dl>
        {worker && <details className="measurement-technical"><summary>查看工具与检测能力</summary><p>已安装工具：{worker.tools.join("、") || "未上报"}</p><div className="measurement-capabilities">{worker.features.map(f => <span key={f}>{featureNames[f] || f}</span>)}</div></details>}
        <div className="measurement-install">
          <strong>{registered ? "保留凭证升级" : "安装探测器"}</strong>
          <p>{registered ? "更新程序与服务，保留现有地址、UUID 和密钥。无需重新生成凭证。" : "先生成一次接入凭证，再到 VPS 执行下方命令，在隐藏提示中输入密钥。"}</p>
          {registered ? <small>升级保留当前轻量 / 完整模式及现有工具。</small> : <label>安装模式<select value={profile} onChange={e => setProfile(e.target.value)}><option value="preserve">自动选择</option><option value="lite">轻量模式</option><option value="full">完整模式</option></select></label>}
          <pre><code>{maintenanceCommand}</code></pre>
          <button disabled={!selected || busy} onClick={() => void act(() => navigator.clipboard.writeText(maintenanceCommand), registered ? "升级命令已复制，现有凭证保持不变" : "安装命令已复制")}>{registered ? "复制升级命令" : "复制安装命令"}</button>
          <small>以 root 登录时省略 sudo。128 MiB VPS 建议轻量模式；轻量模式不自动安装 NextTrace 等可选工具。</small>
        </div>
        {data.runnerRelease && <div className="measurement-auto-update"><label className="network-check"><input type="checkbox" checked={data.updatePolicies["node:" + selected]?.enabled || false} disabled={busy || !registered} onChange={e => void act(() => setWorkerUpdatePolicy("node", selected, e.target.checked), "自动更新偏好已保存")} />允许此 VPS 自动更新探测器</label><p>默认关闭。首次需运行上方升级命令安装维护服务；之后约每小时检查兼容版本，空闲时更新，失败回滚。共用同一机器的接入身份均需允许。</p>{data.updates["node:" + selected] && <small role="status">{data.updates["node:" + selected].message} · {formatNetworkTime(data.updates["node:" + selected].at)}</small>}</div>}
        {!registered && <button disabled={busy || !selected} onClick={() => void issue()}>生成 VPS 接入凭证</button>}
        {registered && <details className="measurement-credentials"><summary>凭证管理</summary><p>仅在密钥遗失或需要轮换时重置。升级探测器不需要更换凭证。</p>
        <div className="network-actions">
          <button
            disabled={busy || !selected}
            onClick={() =>
              setConfirm("reset")
            }
          >
            重置 VPS 凭证
          </button>
          <button
            disabled={
              busy || !selected || !data.registeredNodes.includes(selected)
            }
            onClick={() =>
              setConfirm("revoke")
            }
          >
            撤销 VPS 凭证
          </button>
        </div>
        </details>}
      </section>
      <section className="network-section measurement-endpoint">
        <h3>VPS 公网地址与测速端口</h3>
        <p>
          去程需要可达公网地址。IPv4 和 IPv6
          单独填写；双向测速临时开启带认证的监听，结束后关闭。
        </p>
        <div className="native-field-grid">
          <label>
            公网域名 / 默认地址
            <input
              value={address ?? endpoint?.address ?? ""}
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
          <label>
            IPv4
            <input
              value={ipv4 ?? endpoint?.ipv4 ?? ""}
              onChange={(e) => setIpv4(e.target.value)}
            />
          </label>
          <label>
            IPv6
            <input
              value={ipv6 ?? endpoint?.ipv6 ?? ""}
              onChange={(e) => setIpv6(e.target.value)}
            />
          </label>
          <label>
            临时测速 TCP 端口
            <input
              type="number"
              min={20000}
              max={40000}
              value={port ?? endpoint?.port ?? 25201}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </label>
        </div>
        <button
          disabled={busy || !selected}
          onClick={() =>
            void act(
              () =>
                nativeEndpoint(
                  selected,
                  address ?? endpoint?.address ?? "",
                  ipv4 ?? endpoint?.ipv4 ?? "",
                  ipv6 ?? endpoint?.ipv6 ?? "",
                  port ?? endpoint?.port ?? 25201,
                ),
              "VPS 公网地址已保存",
            )
          }
        >
          保存公网地址
        </button>
      </section>
      </div>
      <section className="network-section measurement-probes">
        <h3>大陆测量点</h3>
        <div className="native-field-grid">
          {(
            [
              ["name", "探针名称"],
              ["city", "大陆城市"],
              ["publicAddress", "可达公网地址（NAT 可留空）"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                value={probe[key]}
                onChange={(e) => setProbe({ ...probe, [key]: e.target.value })}
              />
            </label>
          ))}
          <label>
            运营商
            <select
              value={probe.carrier}
              onChange={(e) => setProbe({ ...probe, carrier: e.target.value })}
            >
              {["电信", "联通", "移动", "其他"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            接入类型
            <select
              value={probe.accessType}
              onChange={(e) =>
                setProbe({ ...probe, accessType: e.target.value })
              }
            >
              {["家庭宽带", "机房", "企业", "未知"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <button
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const c = await registerProbe(probe);
              setCredential({ ...c, role: "probe" });
            }, "大陆测量点凭证已生成")
          }
        >
          生成大陆探针凭证
        </button>
        {data.probes.map((p) => (
          <article className="network-instance-plan" key={p.id}>
            <div>
              <strong>{p.name}</strong>
              <small>
                {p.city} · {p.carrier} · {p.accessType} ·{" "}
                {p.online ? "在线" : "待连接"}
              </small>
              <div className="network-actions"><button disabled={busy} onClick={() => void act(() => navigator.clipboard.writeText(installCommand(p.id, base, { role: "probe", upgrade: true, profile: "preserve" })), "测量点升级命令已复制")}>复制升级命令</button>{data.runnerRelease && <label className="network-check"><input type="checkbox" checked={data.updatePolicies["probe:" + p.id]?.enabled || false} disabled={busy} onChange={e => void act(() => setWorkerUpdatePolicy("probe", p.id, e.target.checked), "测量点自动更新偏好已保存")} />允许自动更新</label>}</div>
            </div>
            <button
              disabled={busy}
              onClick={() =>
                setProbeToRevoke(p.id)
              }
            >
              撤销凭证
            </button>
          </article>
        ))}
      </section>
      {credential && (
        <section className="network-credential-reveal">
          <strong>密钥仅显示一次</strong>
          <code>{credential.token}</code>
          <pre>{command}</pre>
          <p>复制命令到对应设备运行，在隐藏输入提示中粘贴密钥。</p>
          <button
            onClick={() =>
              void act(
                () => navigator.clipboard.writeText(credential.token),
                "密钥已复制",
              )
            }
          >
            复制密钥
          </button>
          <button
            onClick={() =>
              void act(
                () => navigator.clipboard.writeText(command),
                "安装命令已复制",
              )
            }
          >
            复制安装命令
          </button>
          <button onClick={() => setCredential(null)}>隐藏凭证</button>
        </section>
      )}
      {message && <p role="status">{message}</p>}
      {probeToRevoke && <NetworkDrawer title="确认撤销测量点凭证" onClose={() => !busy && setProbeToRevoke(null)}><div className="network-form"><p>撤销后该测量点的原密钥立即失效，关联测量任务会取消。更新程序请使用“复制升级命令”。</p><div className="network-actions"><button disabled={busy} onClick={() => setProbeToRevoke(null)}>取消</button><button disabled={busy} onClick={() => void act(async () => { await revokeProbe(probeToRevoke); if (credential?.id === probeToRevoke) setCredential(null); setProbeToRevoke(null); }, "测量点凭证已撤销")}>确认撤销</button></div></div></NetworkDrawer>}
      {confirm && <NetworkDrawer title={confirm === "reset" ? "确认重置 VPS 凭证" : "确认撤销 VPS 凭证"} onClose={() => !busy && setConfirm(null)}><div className="network-form"><p>{node?.name}：此操作会立即使原密钥失效，原探测器将收到 401，关联测量任务会取消。{confirm === "reset" ? "随后需要把新密钥写入 VPS。" : "重新接入需要生成新凭证。"}</p><p>如果只是更新探测器，请取消并使用“复制升级命令”。</p><div className="network-actions"><button disabled={busy} onClick={() => setConfirm(null)}>取消</button><button disabled={busy} onClick={() => confirm === "reset" ? void issue() : void act(async () => { await revokeNodeToken(selected); setCredential(null); setConfirm(null); }, "VPS 凭证已撤销")}>确认{confirm === "reset" ? "重置" : "撤销"}</button></div></div></NetworkDrawer>}
    </div>
  );
}
