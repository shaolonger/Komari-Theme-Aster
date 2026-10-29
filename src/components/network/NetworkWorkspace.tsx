import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import {
  reportCapabilities,
  reportCatalog,
  runReportSuite,
} from "@/services/reportObservatory";
import { nativeCatalog } from "@/services/nativeObservatory";
import { NetworkReportWorkspace } from "./NetworkReportWorkspace";
import { formatNetworkTime } from "./shared";
import { reportLabels } from "./reportMetrics";
import { useState } from "react";
import "@/styles/network-observatory.css";

export function NetworkWorkspace({
  uuid,
  name,
}: {
  uuid: string;
  name: string;
}) {
  const { data: me } = useAuth(),
    admin = me?.logged_in === true;
  const capability = useQuery({
    queryKey: ["report-capabilities"],
    queryFn: reportCapabilities,
    enabled: admin,
    retry: false,
    staleTime: 60000,
  });
  const catalog = useQuery({
    queryKey: ["report-catalog"],
    queryFn: reportCatalog,
    enabled: admin && !!capability.data,
    staleTime: 30000,
  });
  const points = useQuery({
    queryKey: ["measurement-points"],
    queryFn: nativeCatalog,
    enabled: admin && !!capability.data,
    refetchInterval: 30000,
    retry: false,
  });
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const configure = `/?view=theme-manage&section=network&panel=plans&nodes=${encodeURIComponent(uuid)}`;
  if (!admin)
    return (
      <div className="network-empty-state">
        <p>网络检测报告和配置仅管理员可见。</p>
        <a href="/admin">登录管理后台</a>
      </div>
    );
  if (capability.isPending) return <p role="status">正在连接网络报告服务…</p>;
  if (!capability.data)
    return (
      <div className="network-empty-state">
        <strong>无法读取网络报告能力</strong>
        <p role="alert">{capability.error?.message}</p>
        <p>请启用网络观测插件 1.9.1 或更新版本，并检查授权与插件日志。</p>
        <button onClick={() => void capability.refetch()}>重新连接</button>
      </div>
    );
  const node = catalog.data?.inventory.find((n) => n.uuid === uuid),
    w = points.data?.workers["node:" + uuid];
  const suites =
    catalog.data?.suites.filter(
      (s) =>
        s.clients.includes(uuid) ||
        (s.inherit && s.groups.includes(node?.group || "")),
    ) || [];
  return (
    <div className="network-workspace">
      <div className="network-node-banner">
        <div>
          <strong>
            {name} ·{" "}
            {w
              ? Date.now() - w.seenAt < 90000
                ? "探测器在线"
                : "探测器离线"
              : "等待探测器接入"}
          </strong>
          <small>
            {w
              ? `探测器 ${w.version} · 最近连接 ${formatNetworkTime(w.seenAt)}`
              : "接入与公网地址在网络观测中统一管理"}
          </small>
        </div>
        <a
          href={`/?view=theme-manage&section=network&panel=agents&nodes=${encodeURIComponent(uuid)}`}
        >
          管理探测器
        </a>
      </div>
      {points.error && (
        <p role="alert">
          探测器状态读取失败：{points.error.message}。报告仍可独立查看。
        </p>
      )}
      <section className="network-section network-associated-plans" aria-label="关联检测方案">
        <div className="network-associated-heading"><div><h3>关联检测方案 <span>{suites.length}</span></h3><p>适用于此 VPS 的检测计划</p></div><a href={configure}>配置检测方案</a></div>
        {catalog.isPending && <p role="status">正在读取关联方案…</p>}
        {catalog.error && <p role="alert">{catalog.error.message}</p>}
        {catalog.data && !suites.length && <p>尚未关联方案。在统一配置中心选择预设和执行时间。</p>}
        {!!suites.length && <div className="network-instance-plan-grid">{suites.map((s) => (
          <article key={s.id} className="network-instance-plan">
            <div className="network-instance-plan-main"><div className="network-instance-plan-title"><strong title={s.name}>{s.name}</strong><span data-enabled={s.enabled}>{s.enabled ? "已启用" : "已暂停"}</span></div>
              <small>{s.modules.map(m => reportLabels[m.module] || m.module).join(" / ") || "未配置模块"} · {s.clients.includes(uuid) ? "指定 VPS" : "继承分组"} · {s.modules.length} 个模块</small>
            </div>
            <div className="network-actions"><a aria-label={`编辑 ${s.name} 方案`} href={`${configure}&suite=${encodeURIComponent(s.id)}`}>编辑</a>
              <button aria-label={`立即检测 ${s.name} 的此 VPS`} disabled={busy || !s.enabled} onClick={async () => {
                setBusy(true);
                try { await runReportSuite(s.id, undefined, [uuid]); setMessage(`已启动 ${s.name} 的此 VPS 检测`); }
                catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
                finally { setBusy(false); }
              }}>立即检测</button>
            </div>
          </article>
        ))}</div>}
        {message && <p role="status">{message}</p>}
      </section>
      <NetworkReportWorkspace
        uuid={uuid}
        availableModules={capability.data.modules}
        onConfigure={() => {
          window.location.href = configure;
        }}
      />
    </div>
  );
}
