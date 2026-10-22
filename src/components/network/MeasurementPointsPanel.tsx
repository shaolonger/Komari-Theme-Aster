import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  nativeCatalog,
  nativeEndpoint,
  registerProbe,
  revokeProbe,
  issueNodeToken,
  revokeNodeToken,
} from "@/services/nativeObservatory";
import { formatNetworkTime, installCommand, quoteShell } from "./shared";

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
  const command =
    credential?.role === "node"
      ? installCommand(credential.id, base)
      : `curl -fsSL https://github.com/shaolonger/Komari-Theme-Aster/releases/latest/download/Aster-Network-Observatory-install.sh | sudo sh -s -- --server-url ${quoteShell(base)} --probe-id ${quoteShell(credential?.id || "")}`;
  return (
    <div className="network-form measurement-points-panel">
      <p>
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
      <label>
        VPS
        <select
          value={selected}
          onChange={(e) => {
            setUuid(e.target.value);
            setAddress(null);
            setIpv4(null);
            setIpv6(null);
            setPort(null);
            setCredential(null);
          }}
        >
          {data.inventory.map((n) => (
            <option key={n.uuid} value={n.uuid}>
              {n.name}
            </option>
          ))}
        </select>
      </label>
      <div className="network-section">
        <h3>VPS 探测器</h3>
        {data.inventory
          .filter((n) => n.uuid === selected)
          .map((n) => {
            const w = data.workers["node:" + n.uuid];
            return (
              <p key={n.uuid}>
                {n.name} ·{" "}
                {w
                  ? Date.now() - w.seenAt < 90000
                    ? "在线"
                    : "离线"
                  : data.registeredNodes.includes(n.uuid)
                    ? "等待首次连接"
                    : "未接入"}
                {w && (
                  <>
                    <br />
                    版本 {w.version} · 最近连接 {formatNetworkTime(w.seenAt)}
                    <br />
                    工具：{w.tools.join("、")}
                    <br />
                    能力：{w.features.join("、") || "请升级探测器"}
                  </>
                )}
              </p>
            );
          })}
        <div className="network-actions">
          <button
            disabled={busy || !selected}
            onClick={() =>
              void act(async () => {
                const c = await issueNodeToken(selected);
                setCredential({ id: c.uuid, token: c.token, role: "node" });
              }, "已生成凭证，请运行安装命令")
            }
          >
            生成 / 重置 VPS 凭证
          </button>
          <button
            disabled={
              busy || !selected || !data.registeredNodes.includes(selected)
            }
            onClick={() =>
              void act(async () => {
                await revokeNodeToken(selected);
                setCredential(null);
              }, "VPS 凭证已撤销")
            }
          >
            撤销 VPS 凭证
          </button>
        </div>
      </div>
      <section className="network-section">
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
      <section className="network-section">
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
            </div>
            <button
              disabled={busy}
              onClick={() =>
                void act(() => revokeProbe(p.id), "测量点凭证已撤销")
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
    </div>
  );
}
